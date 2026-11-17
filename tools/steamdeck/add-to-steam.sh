#!/usr/bin/env bash
# Installs a Solarbloom AppImage on a Steam Deck and adds it to Steam as a non-Steam game.
# Run in Desktop Mode (Konsole):   bash add-to-steam.sh ~/Downloads/Solarbloom-*-steamdeck.AppImage
set -euo pipefail

src="${1:-}"
if [ -z "$src" ] || [ ! -f "$src" ]; then
  echo "Usage: bash add-to-steam.sh <path to the Solarbloom AppImage>" >&2
  exit 1
fi

app_dir="$HOME/Applications"
app="$app_dir/Solarbloom.AppImage"
desktop="$HOME/.local/share/applications/solarbloom.desktop"
mkdir -p "$app_dir" "$(dirname "$desktop")"
cp -f "$src" "$app"
chmod +x "$app"

cat > "$desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Solarbloom
Comment=Bring a dead park and city back to life
Exec="$app"
Terminal=false
Categories=Game;
DESKTOP
chmod +x "$desktop"
echo "Installed to $app"

if command -v steamos-add-to-steam >/dev/null 2>&1; then
  steamos-add-to-steam "$desktop"
  echo "Added to Steam. Find Solarbloom under Library > Non-Steam, then return to Gaming Mode."
else
  echo "steamos-add-to-steam was not found (not SteamOS?)."
  echo "Add it by hand: Steam > Games > Add a Non-Steam Game to My Library > Solarbloom."
fi
