# Generates the base models in docs/art/meshy-assets.md with Tripo, as SHAPE GUIDES: a textured GLB per model,
# no quad conversion. Each is rebuilt clean in Blender afterwards (flat palette materials, exact edges); dead and
# restored versions, tiers, variants and upgrade parts are made there too, so only one base model is generated.
# Needs $env:TRIPO_API_KEY. Writes assets/raw/tripo/models/<name>.glb and <name>.preview.webp, and records task
# ids in models/tasks.json so a rerun skips finished work.
#   powershell -File assets/tools/tripo_models.ps1                 # everything, in priority order
#   powershell -File assets/tools/tripo_models.ps1 -Limit 3        # only the first 3 not yet done
#   powershell -File assets/tools/tripo_models.ps1 -MinCredits 40  # stop submitting below this balance
param([int]$Limit = 0, [int]$MinCredits = 25, [int]$Batch = 6)
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot/../..")
$api = "https://api.tripo3d.ai/v2/openapi"
$h = @{ Authorization = "Bearer $env:TRIPO_API_KEY" }
$dir = "assets/raw/tripo/models"
New-Item -ItemType Directory -Force $dir | Out-Null
$state = @{}
if (Test-Path "$dir/tasks.json") { (Get-Content "$dir/tasks.json" -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = $_.Value } }

# docs/art/meshy-assets.md style prefix. Every model is generated in its clean, restored state.
$style = "stylized solarpunk game asset, soft bevelled edges, cream ceramic and white plastic, brushed gold trim, warm limestone, clean readable silhouette, simple chunky shapes, bright clean colours, no baked shadows, isometric game prop, a single isolated object, finished on all sides"
$negative = "text, logo, people, character standing next to it, ground plane, base platform, scenery, multiple objects"
$models = [ordered]@{
  # characters
  "cultivator"        = "a small cute solar-powered garden tractor robot on short rubber treads, a spinning tine drum at the front, a tilted solar panel canopy on top, a glass seed hopper on the back, a moss roller at the rear"
  "lucky-cat"         = "a small cute sitting maneki-neko lucky cat figurine, white ceramic with a red collar and a gold bell, one paw raised"
  # machines
  "water-condenser"   = "a water condenser machine: a cream ceramic cylindrical body with a tall clear glass water tank on top showing blue water, a domed lid, two brass valves and short copper pipes"
  "rooftop-core"      = "a rooftop energy core: a stepped round limestone dais with a cream arch over it and a large glowing green leaf emblem inside the arch"
  "pollinator-garden" = "a pollinator garden: a round cream stone basin full of flowers with two small wooden bee hive boxes beside it"
  "drone-hub"         = "a drone charging hub: a round cream landing pad on a short pedestal with a slim mast and a glowing cyan charging ring around the pad"
  "mother-tree-collar"= "a round planter base for a large tree: a cream stone planter with a brushed brass collar ring around the trunk opening, no tree"
  "reservoir-basin"   = "a wide round white ceramic water basin garden with a gold rim, empty, shallow"
  "bloom-relay"       = "a bloom relay pylon: a slim cream pylon on a round base with a large glowing green crystal held at the top by gold prongs"
  # landmarks
  "dry-fountain"      = "a classic round park fountain: a wide stone basin with a central pedestal and a smaller upper bowl, cream limestone with gold trim, no water"
  "bandstand"         = "a small round park bandstand gazebo: cream columns, a domed copper-green roof with a gold finial, a low railing and three steps"
  "signal-mast"       = "a tall street signal mast: a slim cream lattice tower with round signal lamps and a gold weather vane on top"
  "clock-tower"       = "a small square clock tower: cream limestone with a large round clock face on each side, a copper-green pyramid roof and a gold finial"
  "lock-gate"         = "a canal lock gate: two heavy wooden gate leaves between stone walls, brass winding gear on top"
  "market-hall"       = "a small covered market hall: cream limestone arches, a long pitched terracotta roof with skylights, wooden doors"
  "old-cistern"       = "an old round stone water cistern tower with a domed roof, a small arched door and a brass spout"
  # area obstacles
  "bench"             = "a classic park bench: wooden slats on curled cast-iron legs and armrests"
  "stump"             = "a cut tree stump with exposed roots, rings visible on the top"
  "bollard"           = "a short round street bollard: cream with a gold band near the top and a domed cap"
  "cracked-pillar"    = "a broken classical stone column with a cracked top, cream limestone"
  "mooring-post"      = "a short iron canal mooring post with a rounded top"
  "market-stall"      = "a small wooden market stall with a striped canvas awning and an empty counter"
  "dry-drain"         = "a square stone street drain grate set in a small paved square"
  "barrel"            = "a wooden barrel with brass hoops"
  # edge clutter
  "ac-unit"           = "a rooftop air conditioning unit: a cream metal box with a large round fan grille on top"
  "copper-pipe"       = "a short straight copper pipe section with flanges at both ends and a small brass valve wheel"
  "crate"             = "a wooden shipping crate with planks and corner braces"
  "vent"              = "a rooftop ventilation duct with a mushroom cap"
  "lantern"           = "a hanging garden lantern: a brass frame with glowing warm glass panes"
  "lamp-post"         = "a classic park lamp post: a slim cream post with a gold-trimmed glass lantern head"
  "broken-pot"        = "a cracked terracotta flower pot lying on its side"
  "rubble-pile"       = "a small pile of broken concrete chunks and bricks"
  "stone-block"       = "a single rough cut limestone block with chipped corners"
  "wall-niche"        = "a small arched niche shrine set in a stone wall block"
  "banner-pole"       = "a tall slim cream pole with a gold finial and a horizontal crossbar for hanging a banner, no banner"
  "satellite-dish"    = "a small rooftop satellite dish on a short mount"
  # planters
  "planter-trough"    = "a long rectangular stone planter trough, cream limestone with a gold rim, filled with soil"
  "planter-bed"       = "a square raised garden bed made of cream stone with a gold corner trim, filled with soil"
  "planter-pot"       = "a large round cream ceramic plant pot with a gold rim, filled with soil"
  # skyline (optional, last)
  "skyline-tower"     = "a tall terraced solarpunk tower with hanging gardens on every level, cream and white"
  "skyline-bridge"    = "a long elegant cream sky bridge span with planters along it"
  "skyline-dome"      = "a large glass greenhouse dome with a gold frame"
  "skyline-cliff"     = "a tall rock cliff block with a waterfall and greenery"
}

function Save-State { $state | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 "$dir/tasks.json" }
function Balance { (Invoke-RestMethod -Uri "$api/user/balance" -Headers $h -TimeoutSec 60).data.balance }
function Submit($body) {
  $r = Invoke-RestMethod -Method Post -Uri "$api/task" -Headers $h -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 5) -TimeoutSec 60
  if ($r.code -ne 0) { throw "submit failed: $($r | ConvertTo-Json -Compress)" }
  return $r.data.task_id
}
function Wait-Task($id) {
  while ($true) {
    $d = (Invoke-RestMethod -Uri "$api/task/$id" -Headers $h -TimeoutSec 60).data
    if ($d.status -eq "success") { return $d }
    if ($d.status -notin "queued", "running") { throw "task $id ended: $($d.status)" }
    Start-Sleep 8
  }
}

$todo = @($models.Keys | Where-Object { -not (Test-Path "$dir/$_.glb") })
if ($Limit -gt 0) { $todo = @($todo | Select-Object -First $Limit) }
$start = Balance
"balance $start; $($todo.Count) to generate"
for ($i = 0; $i -lt $todo.Count; $i += $Batch) {
  $batchKeys = @($todo[$i..([Math]::Min($i + $Batch, $todo.Count) - 1)])
  foreach ($k in $batchKeys) {
    if (-not $state[$k]) {
      $bal = Balance
      if ($bal -lt $MinCredits) { "stopping: $bal credits left (minimum $MinCredits)"; Save-State; break }
      $state[$k] = Submit @{ type = "text_to_model"; prompt = "$style. $($models[$k])"; negative_prompt = $negative; texture = $true; pbr = $false }
      "submitted $k -> $($state[$k])"; Save-State
    }
  }
  foreach ($k in $batchKeys) {
    if (-not $state[$k]) { continue }
    try {
      $d = Wait-Task $state[$k]
      $url = if ($d.output.pbr_model) { $d.output.pbr_model } elseif ($d.output.model) { $d.output.model } else { $d.output.base_model }
      Invoke-WebRequest $url -OutFile "$dir/$k.glb" -UseBasicParsing
      if ($d.output.rendered_image) { Invoke-WebRequest $d.output.rendered_image -OutFile "$dir/$k.preview.webp" -UseBasicParsing }
      "downloaded $k"
    } catch { "FAILED $k : $_"; $state.Remove($k); Save-State }
  }
}
$end = Balance
"done; credits $start -> $end (spent $($start - $end))"
