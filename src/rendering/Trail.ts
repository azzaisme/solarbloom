import * as pc from 'playcanvas';
import { heightAt, levelY } from '../core/Height';
import { BLOOMBOT_EYE_HEIGHT } from '../data/botProps';
import { WAYMARK } from '../data/waymark';
import type { Sim } from '../gameplay/Sim';
import { trailDots, type TrailRoute } from '../gameplay/TrailRoute';
import { SLAB_TOP } from './SceneBuilder';
import { PALETTE } from './Palette';
import { pavingOverlayLift } from './PavingSurface';
import { group } from './Shapes';
import { glowMaterial } from './TileFx';
import { clamp01, leafColor, leafFlight, LEAF_INDICES, LEAF_VERTICES, randomLeafLaunch, smooth, type LeafLaunch } from './TrailLeaf';
import { TrailLight } from './TrailLight';

interface Landing {
  x: number;
  y: number;
  z: number;
  s: number;
  heading: number;
  routeX: number;
  routeZ: number;
  phase: number;
  launch: LeafLaunch;
}

/** Show me where: a light ribbon at visor height sheds leaves onto the walkable route. */
export class Trail {
  private root: pc.Entity;
  private material: pc.StandardMaterial;
  private light: TrailLight;
  private mesh?: pc.Mesh;
  private leaves: Landing[] = [];
  private flurries: { leafIndex: number; launch: LeafLaunch; cycle: number }[] = [];
  private colors = new Uint8Array(0);
  private positions = new Float32Array(0);
  private route?: TrailRoute;
  private age = 0;
  private progress = 0;
  private leaving = 0;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
  ) {
    this.root = group(parent, 'trail');
    this.light = new TrailLight(this.root);
    this.material = glowMaterial(PALETTE.pure.white, WAYMARK.trail.glow);
    this.root.enabled = false;
  }

  get showing(): boolean {
    return this.root.enabled && !!this.route;
  }

  get way(): TrailRoute | undefined {
    return this.showing ? this.route : undefined;
  }

  get count(): number {
    return this.leaves.length;
  }

  /** Lays the landing points out once and uses a single mesh for all of the leaves. */
  show(route: TrailRoute) {
    this.clear();
    const layer = this.sim.grid.layer(route.roofId);
    const dots = trailDots(route.points);
    if (!layer || !dots.length) return;
    const terraced = this.sim.grid.terraced(route.roofId);
    const surface = (x: number, z: number) => {
      const tile = this.sim.grid.peek(route.roofId, Math.floor(x), Math.floor(z));
      return layer.origin[1] + layer.height + SLAB_TOP + pavingOverlayLift(this.sim.grid, tile) +
        (terraced ? levelY(heightAt(x, z)) : 0);
    };
    this.route = route;
    this.leaves = dots.map((dot, index) => ({
      x: layer.origin[0] + dot.x,
      y: surface(dot.x, dot.z) + WAYMARK.trail.lift,
      z: layer.origin[2] + dot.z,
      s: dot.s,
      routeX: dot.x,
      routeZ: dot.z,
      heading: dot.heading,
      phase: index * 2.399963,
      launch: randomLeafLaunch(),
    }));
    this.light.show(trailDots(route.points, WAYMARK.trail.spacing / 4, WAYMARK.trail.max * 4).map(dot => ({
      x: layer.origin[0] + dot.x,
      y: surface(dot.x, dot.z) + BLOOMBOT_EYE_HEIGHT,
      z: layer.origin[2] + dot.z,
      s: dot.s,
      heading: dot.heading,
    })));
    this.age = this.progress = this.leaving = 0;
    // A few extra drifting leaves keep the next stretch alive. They share the mesh and never replace the route.
    this.flurries = [];
    for (let i = 2; i < this.leaves.length; i += 4) this.flurries.push({ leafIndex: i, launch: randomLeafLaunch(), cycle: -1 });

    const mesh = new pc.Mesh(pc.AppBase.getApplication()!.graphicsDevice);
    const slots = [...this.leaves.map((_, i) => i), ...this.flurries.map(flurry => flurry.leafIndex)];
    const count = slots.length * LEAF_VERTICES.length;
    this.positions = new Float32Array(count * 3);
    this.colors = new Uint8Array(count * 4);
    const indices: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      const base = i * LEAF_VERTICES.length;
      for (const index of LEAF_INDICES) indices.push(base + index);
      LEAF_VERTICES.forEach((vertex, j) => this.colors.set(leafColor(slots[i] + (i < this.leaves.length ? 0 : 1), vertex), (base + j) * 4));
    }
    this.mesh = mesh;
    this.draw(0);
    mesh.setIndices(indices);
    mesh.update();
    this.root.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.material)], castShadows: false, receiveShadows: false });
    this.root.enabled = true;
  }

  clear() {
    this.light.clear();
    if (this.root.render) this.root.removeComponent('render');
    this.mesh?.destroy();
    this.mesh = undefined;
    this.route = undefined;
    this.leaves = [];
    this.flurries = [];
    this.root.enabled = false;
  }

  private draw(fade: number, camera?: pc.Vec3) {
    const T = WAYMARK.trail;
    const total = this.leaves[this.leaves.length - 1].s;
    const revealSpeed = Math.max(T.draw, total / T.drawMax);
    for (let i = 0; i < this.leaves.length; i++) {
      const leaf = this.leaves[i];
      const elapsed = this.age - leaf.s / revealSpeed;
      const fallTime = T.fallSeconds + 0.64 * (0.5 + 0.5 * Math.sin(leaf.phase));
      const fraction = this.reducedMotion ? 1 : clamp01(elapsed / fallTime);
      const alpha = (this.reducedMotion ? 1 : smooth(elapsed / T.fadeIn)) *
        smooth((leaf.s - this.progress + T.behind * 0.5) / T.behind) *
        (this.route!.reached ? 1 : 0.55 + 0.45 * smooth((total - leaf.s) / 3)) * (1 - fade);
      this.drawLeaf(i, leaf, leaf.launch, fraction, alpha, camera);
    }
    for (let i = 0; i < this.flurries.length; i++) {
      const flurry = this.flurries[i];
      const leaf = this.leaves[flurry.leafIndex];
      const ahead = leaf.s - this.progress;
      const clock = this.age + leaf.phase;
      const lap = Math.floor(clock / 8.4);
      if (lap !== flurry.cycle) {
        flurry.cycle = lap;
        flurry.launch = randomLeafLaunch();
      }
      const cycle = clock % 8.4;
      const fraction = clamp01(cycle / 3.8);
      const alpha = this.reducedMotion || this.age < 4 ? 0 :
        0.72 * smooth(cycle / 0.6) * (1 - smooth((fraction - 0.76) / 0.24)) *
        smooth(ahead / 2) * (1 - smooth((ahead - 8) / 5)) * (1 - fade);
      this.drawLeaf(this.leaves.length + i, leaf, flurry.launch, fraction, alpha, camera, 0.72, 2.7);
    }
    this.mesh!.setPositions(this.positions);
    this.mesh!.setColors32(this.colors);
  }

  private drawLeaf(index: number, leaf: Landing, launch: LeafLaunch, fraction: number, alpha: number, camera?: pc.Vec3, size = 1, phaseOffset = 0) {
    const T = WAYMARK.trail;
    const phase = leaf.phase + phaseOffset;
    const flight = leafFlight(fraction, phase, BLOOMBOT_EYE_HEIGHT - T.lift, launch);
    const heading = leaf.heading + Math.sin(phase) * 0.16;
    const x = leaf.x + Math.cos(heading) * flight.sideways + Math.sin(heading) * flight.along;
    const z = leaf.z - Math.sin(heading) * flight.sideways + Math.cos(heading) * flight.along;
    const y = leaf.y + flight.height;
    const distance = camera ? Math.hypot(x - camera.x, y - camera.y, z - camera.z) : 0;
    const scale = size * (0.83 + 0.17 * Math.cos(phase + 0.6)) *
      Math.min(T.farScale, Math.max(1, 1 + (distance - T.nearDistance) * T.growth));
    this.placeLeaf(index, x, y, z, flight.yaw, flight.pitch, flight.roll, scale, alpha);
  }

  private placeLeaf(index: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, scale: number, alpha: number) {
    const sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw);
    const sinPitch = Math.sin(pitch), cosPitch = Math.cos(pitch);
    const sinRoll = Math.sin(roll), cosRoll = Math.cos(roll);
    let offset = index * LEAF_VERTICES.length;
    for (const vertex of LEAF_VERTICES) {
      const side = vertex.x * cosRoll - vertex.y * sinRoll;
      const lift = vertex.x * sinRoll + vertex.y * cosRoll;
      const forward = lift * sinPitch + vertex.z * cosPitch;
      this.positions[offset * 3] = x + (side * cosYaw + forward * sinYaw) * scale;
      this.positions[offset * 3 + 1] = y + (lift * cosPitch - vertex.z * sinPitch) * scale;
      this.positions[offset * 3 + 2] = z + (forward * cosYaw - side * sinYaw) * scale;
      this.colors[offset * 4 + 3] = Math.round(255 * alpha);
      offset++;
    }
  }

  update(dt: number, show: boolean, bot: { roofId: string; x: number; z: number } | undefined, night: number, camera?: pc.Vec3) {
    const route = this.route;
    if (!route || !this.mesh) return;
    const T = WAYMARK.trail;
    this.age += dt;
    const total = this.leaves[this.leaves.length - 1].s;
    if (bot && bot.roofId === route.roofId) {
      let best = Infinity;
      let at = this.progress;
      for (const leaf of this.leaves) {
        if (leaf.s < this.progress - 2 || leaf.s > this.progress + 8) continue;
        const distance = Math.hypot(leaf.routeX - bot.x, leaf.routeZ - bot.z);
        if (distance < best) {
          best = distance;
          at = leaf.s;
        }
      }
      if (best < 1.2) this.progress = Math.max(this.progress, at);
      const end = route.points[route.points.length - 1];
      if (Math.hypot(end.x - bot.x, end.z - bot.z) < T.reach * 0.75 && this.progress > total - T.reach * 2) {
        this.leaving = Math.min(1, this.leaving + dt / T.fade);
      }
    }
    const fade = Math.max(this.leaving, smooth((this.age - T.life) / T.fade));
    if (fade >= 1) return this.clear();
    this.root.enabled = show;
    if (!show) return;
    this.draw(fade, camera);
    this.light.update(this.age, this.progress, Math.max(T.draw, total / T.drawMax), fade, this.reducedMotion, camera);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES);
    this.material.emissiveIntensity = T.glow + (T.nightGlow - T.glow) * clamp01(night);
    this.material.update();
  }
}
