# Solarbloom botanical machine kit

Original models authored for this repository. No third-party mesh, texture or AI-generated image assets are included. The design combines enamel/ceramic shells, brass and copper fittings, botanical vanes, cooling vents, charge contacts and glass water tanks.

Regenerate every binary with Python 3 (no dependencies):

```sh
python3 scripts/generate-models.py
```

The glTF 2.0 binary assets contain indexed geometry, smooth normals, PBR materials and named animation pivots. The runtime shares meshes/materials between instances. Animation is driven by presentation code in `MachineVisuals` and `DroneVisuals`; it follows existing simulation state. These assets intentionally contain no gameplay or balance data.

| Asset | Presentation |
| --- | --- |
| solar | Articulated cell array, servo housing, power cable; unfolds and tracks the sun |
| condenser | Glass chamber, copper intake, outlet pipe and rotor; water charge and circulation |
| pollinator | Ceramic planter with curved leaves and petal meshes; sequential unfurl and wind sway |
| droneHub | Charging dock with contacts, vents, service console and rotating guidance ring |
| drone | Rounded shell, dark visor, leaf wings and emissive eyes; banking, hovering, blinking and work beam |
| motherTree | Living canopy with copper root collectors; sway and charge pulse |
| relay | Coil-wrapped transmitter with rotating botanical vanes |
| reservoirGarden | Sculpted basin, copper water intake, pump housing and floating lilies |
| fountain | Turned stone basin and tiered bowl; retains dormant-to-awake material transition |
| coreArch | Ceramic and brass arch with climbing leaves and blossoms around the rooftop core |

Approximate download size: 4.7 MB total, before HTTP compression. Materials and meshes are retained for the app lifetime. State-specific fountain materials are cloned per landmark. Large-city performance on mobile GPUs still needs real-device profiling.
