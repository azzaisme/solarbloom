#!/usr/bin/env node
/**
 * B5 (#468): give the ten Keepers bloombot's sitting clips (sit-down, sit, stand-up), so they sit on benches with a
 * real animation instead of SeatPose's hand-bent legs.
 *
 * The Keepers were rigged by the same auto-rigger as bloombot: the same 24 joints with the same names, under the
 * same 0.01-scale Armature. But each character's rest pose is its own (every joint's rest rotation differs), so the
 * clip cannot be copied channel for channel: a copied local rotation would twist a limb by the difference between
 * the two rest poses. Instead each frame is retargeted through world space:
 *
 *   for each joint, D = W_src(frame) * inverse(W_src(rest))   how far the bone has turned from its rest, in world
 *                   W_dst(frame) = D * W_dst(rest)            the Keeper's bone turned the same way from its rest
 *                   L_dst = inverse(W_dst(parent)) * W_dst     back to the Keeper's local rotation
 *
 * The legs need one more step. A Keeper's thigh and shin can rest at a different angle from bloombot's (Fern's and
 * Tally's legs splay), and the same world turn then leaves its thighs pointing up instead of level on the seat. So for
 * the leg bones the Keeper's rest pose is first swung to lie along bloombot's rest bone (A), and the turn applied to
 * that: W_dst(frame) = D * A * W_dst(rest). A seated Keeper's thighs are then level and its shins hang down, as
 * bloombot's do.
 *
 * The hips' travel (how far it drops onto the seat) is scaled by the ratio of the two rigs' leg lengths, then raised
 * or lowered on each frame so the Keeper's lowest toe stays where it is at rest: feet on the ground, as bloombot's (thigh plus
 * shin, at rest), so a Keeper with longer legs drops further and one with short legs under a high body (Fern, Tally)
 * doesn't sink through its own seat. Every other joint keeps its own rest translation and scale.
 *
 * Usage: node assets/tools/retarget_keeper_clips.mjs [keeper-a.glb ...]
 *   With no files it does every assets/raw/models/final/keeper-*.glb and its .lod1.glb. A file that already has a
 *   clip of one of these names is left alone (so a re-run changes nothing); pass --replace to rebuild those clips.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets/raw/bloombot/bloombot.glb';
const CLIPS = ['sit-down', 'sit', 'stand-up'];
const FPS = 30;

// ---- GLB io ----
function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = Buffer.alloc(0);
  const o = 20 + jsonLen;
  if (o < b.length) bin = Buffer.from(b.subarray(o + 8, o + 8 + b.readUInt32LE(o)));
  return { json, bin };
}
function writeGlb(file, { json, bin }) {
  const pad = (buf, ch) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4), ch)]) : buf);
  json.buffers[0].byteLength = bin.length;
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const bb = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + bb.length, 8);
  const ch = (len, type) => {
    const c = Buffer.alloc(8);
    c.writeUInt32LE(len, 0);
    c.writeUInt32LE(type, 4);
    return c;
  };
  fs.writeFileSync(file, Buffer.concat([head, ch(j.length, 0x4e4f534a), j, ch(bb.length, 0x004e4942), bb]));
}
function readAccessor(g, i) {
  const a = g.json.accessors[i];
  const v = g.json.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  if (a.componentType !== 5126) throw new Error('only float accessors are expected in clips');
  const off = (v.byteOffset || 0) + (a.byteOffset || 0);
  const stride = v.byteStride || n * 4;
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const e = [];
    for (let c = 0; c < n; c++) e.push(g.bin.readFloatLE(off + k * stride + c * 4));
    out.push(n === 1 ? e[0] : e);
  }
  return out;
}
function addAccessor(g, values, type) {
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const flat = new Float32Array(values.length * n);
  values.forEach((v, k) => (n === 1 ? (flat[k] = v) : v.forEach((c, i) => (flat[k * n + i] = c))));
  const align = (4 - (g.bin.length % 4)) % 4;
  const off = g.bin.length + align;
  g.bin = Buffer.concat([g.bin, Buffer.alloc(align), Buffer.from(flat.buffer)]);
  g.json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: flat.byteLength });
  const acc = { bufferView: g.json.bufferViews.length - 1, componentType: 5126, count: values.length, type };
  if (type === 'SCALAR') {
    acc.min = [Math.min(...values)];
    acc.max = [Math.max(...values)];
  }
  g.json.accessors.push(acc);
  return g.json.accessors.length - 1;
}

// ---- quaternions [x,y,z,w] ----
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => {
  const l = Math.hypot(...q) || 1;
  return q.map((c) => c / l);
};
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) {
    b = b.map((c) => -c);
    d = -d;
  }
  if (d > 0.9995) return qnorm(a.map((c, i) => c + (b[i] - c) * t));
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((c, i) => c * wa + b[i] * wb);
}
const lerp = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

// ---- rig ----
function rig(g) {
  const nodes = g.json.nodes;
  const joints = g.json.skins[0].joints;
  const parent = {};
  nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const byName = Object.fromEntries(joints.map((i) => [nodes[i].name, i]));
  // joints in parent-before-child order
  const depth = (i) => (parent[i] === undefined || !joints.includes(parent[i]) ? 0 : 1 + depth(parent[i]));
  const order = [...joints].sort((a, b) => depth(a) - depth(b));
  const rest = Object.fromEntries(
    joints.map((i) => [i, { t: nodes[i].translation || [0, 0, 0], r: nodes[i].rotation || [0, 0, 0, 1], s: nodes[i].scale || [1, 1, 1] }]),
  );
  return { nodes, joints, parent, byName, order, rest };
}
/** rest positions in the Armature's space (rotations and translations; the rigs carry no joint scale) */
function restPos(R) {
  const p = {}, r = {};
  for (const i of R.order) {
    const par = R.parent[i];
    if (par !== undefined && p[par]) {
      const v = qmul(qmul(r[par], [...R.rest[i].t, 0]), qinv(r[par]));
      p[i] = [p[par][0] + v[0], p[par][1] + v[1], p[par][2] + v[2]];
      r[i] = qnorm(qmul(r[par], R.rest[i].r));
    } else {
      p[i] = R.rest[i].t;
      r[i] = R.rest[i].r;
    }
  }
  return p;
}
/** the shortest rotation taking unit vector a onto unit vector b */
function swing(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 0.999999) return [0, 0, 0, 1];
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return qnorm([c[0], c[1], c[2], 1 + d]);
}
const unit = (a, b) => {
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const LEG = { LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', RightUpLeg: 'RightLeg', RightLeg: 'RightFoot' };
/** per leg bone of D, the swing laying its rest direction (bone to child) along S's */
function legAlign(S, D) {
  const ps = restPos(S), pd = restPos(D);
  const out = {};
  for (const [bone, child] of Object.entries(LEG)) {
    const ds = unit(ps[S.byName[bone]], ps[S.byName[child]]);
    const dd = unit(pd[D.byName[bone]], pd[D.byName[child]]);
    out[D.byName[bone]] = swing(dd, ds);
  }
  return out;
}
/** the lower toe's height in the Armature's space, for world rotations `w` and the hips at `hips` */
function lowestToe(R, w, hips) {
  const p = {};
  for (const i of R.order) {
    const par = R.parent[i];
    if (par !== undefined && p[par]) {
      const v = qmul(qmul(w[par], [...R.rest[i].t, 0]), qinv(w[par]));
      p[i] = [p[par][0] + v[0], p[par][1] + v[1], p[par][2] + v[2]];
    } else p[i] = i === R.byName.Hips ? hips : R.rest[i].t;
  }
  return Math.min(p[R.byName.LeftToeBase][1], p[R.byName.RightToeBase][1]);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function legLength(R) {
  const p = restPos(R);
  const j = (n) => p[R.byName[n]];
  return ['Left', 'Right'].reduce((s, side) => s + dist(j(`${side}UpLeg`), j(`${side}Leg`)) + dist(j(`${side}Leg`), j(`${side}Foot`)), 0) / 2;
}

/** world rotations (relative to the Armature, which carries no rotation in either file) for a local-rotation map */
function worldRot(R, local) {
  const w = {};
  for (const i of R.order) {
    const p = R.parent[i];
    w[i] = p !== undefined && w[p] ? qnorm(qmul(w[p], local[i])) : local[i];
  }
  return w;
}

// ---- source clips, sampled on a common timeline ----
function sampler(g, anim, ch) {
  const s = anim.samplers[ch.sampler];
  const ts = readAccessor(g, s.input), vs = readAccessor(g, s.output);
  const step = s.interpolation === 'STEP';
  const cubic = s.interpolation === 'CUBICSPLINE';
  const val = (k) => (cubic ? vs[k * 3 + 1] : vs[k]);
  return (t) => {
    if (t <= ts[0]) return val(0);
    if (t >= ts[ts.length - 1]) return val(ts.length - 1);
    let k = 0;
    while (ts[k + 1] < t) k++;
    if (step) return val(k);
    const u = (t - ts[k]) / (ts[k + 1] - ts[k]);
    return ch.target.path === 'rotation' ? slerp(val(k), val(k + 1), u) : lerp(val(k), val(k + 1), u);
  };
}
function sourceClip(g, R, name) {
  const anim = g.json.animations.find((a) => a.name === name);
  if (!anim) throw new Error(`bloombot has no clip "${name}"`);
  const rot = {}, tr = {};
  let end = 0;
  for (const ch of anim.channels) {
    const node = ch.target.node;
    if (!R.joints.includes(node)) continue;
    end = Math.max(end, g.json.accessors[anim.samplers[ch.sampler].input].max[0]);
    if (ch.target.path === 'rotation') rot[node] = sampler(g, anim, ch);
    if (ch.target.path === 'translation') tr[node] = sampler(g, anim, ch);
  }
  return { rot, tr, end };
}

// ---- retarget one clip onto one Keeper file ----
function retarget(src, S, dst, D, name) {
  const clip = sourceClip(src, S, name);
  const frames = Math.max(2, Math.round(clip.end * FPS) + 1);
  const times = Array.from({ length: frames }, (_, k) => Math.min(clip.end, k / FPS));
  const sRestLocal = Object.fromEntries(S.joints.map((i) => [i, S.rest[i].r]));
  const sRestW = worldRot(S, sRestLocal);
  const dRestLocal = Object.fromEntries(D.joints.map((i) => [i, D.rest[i].r]));
  const dRestW = worldRot(D, dRestLocal);
  const sHips = S.byName.Hips, dHips = D.byName.Hips;
  const k = legLength(D) / legLength(S);
  const restP = restPos(D);
  const restToeY = Math.min(restP[D.byName.LeftToeBase][1], restP[D.byName.RightToeBase][1]);
  const align = legAlign(S, D);

  const outRot = Object.fromEntries(D.joints.map((i) => [i, []]));
  const hipsT = [];
  for (const t of times) {
    const sLocal = {};
    for (const i of S.joints) sLocal[i] = clip.rot[i] ? qnorm(clip.rot[i](t)) : sRestLocal[i];
    const sW = worldRot(S, sLocal);
    const dW = {};
    for (const j of D.order) {
      const name = D.nodes[j].name;
      const si = S.byName[name];
      if (si === undefined) throw new Error(`bloombot has no joint "${name}"`);
      const delta = qmul(sW[si], qinv(sRestW[si]));
      dW[j] = qnorm(align[j] ? qmul(delta, qmul(align[j], dRestW[j])) : qmul(delta, dRestW[j]));
      const p = D.parent[j];
      const local = p !== undefined && dW[p] ? qmul(qinv(dW[p]), dW[j]) : dW[j];
      const prev = outRot[j][outRot[j].length - 1];
      let q = qnorm(local);
      // keep neighbouring keys in the same hemisphere so linear interpolation never takes the long way round
      if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((c) => -c);
      outRot[j].push(q);
    }
    const st = clip.tr[sHips] ? clip.tr[sHips](t) : S.rest[sHips].t;
    const sr = S.rest[sHips].t, dr = D.rest[dHips].t;
    const hips = [dr[0] + (st[0] - sr[0]) * k, dr[1] + (st[1] - sr[1]) * k, dr[2] + (st[2] - sr[2]) * k];
    // feet on the ground: bloombot's clips keep its feet flat on every frame, but a Keeper's legs are not bloombot's
    // in proportion, so its hips are raised or lowered until its lowest toe is where it stands at rest
    hips[1] += restToeY - lowestToe(D, dW, hips);
    hipsT.push(hips);
  }

  const anim = { name, channels: [], samplers: [] };
  const input = addAccessor(dst, times, 'SCALAR');
  const input2 = addAccessor(dst, [0, clip.end], 'SCALAR');
  const add = (node, pathName, values, inp, interp = 'LINEAR') => {
    anim.samplers.push({ input: inp, output: addAccessor(dst, values, pathName === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: interp });
    anim.channels.push({ sampler: anim.samplers.length - 1, target: { node, path: pathName } });
  };
  for (const j of D.joints) {
    if (j === dHips) add(j, 'translation', hipsT, input);
    else add(j, 'translation', [D.rest[j].t, D.rest[j].t], input2);
    add(j, 'rotation', outRot[j], input);
    add(j, 'scale', [D.rest[j].s, D.rest[j].s], input2, 'STEP');
  }
  dst.json.animations = dst.json.animations || [];
  dst.json.animations.push(anim);
  return frames;
}

// ---- main ----
const args = process.argv.slice(2);
const replace = args.includes('--replace');
let files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  const dir = 'assets/raw/models/final';
  files = fs.readdirSync(dir).filter((f) => /^keeper-.*\.glb$/.test(f)).map((f) => path.join(dir, f));
}
const src = readGlb(SRC);
const S = rig(src);
for (const f of files) {
  const dst = readGlb(f);
  const D = rig(dst);
  const have = new Set((dst.json.animations || []).map((a) => a.name));
  const todo = CLIPS.filter((c) => replace || !have.has(c));
  if (!todo.length) {
    console.log(`${f}: already has ${CLIPS.join(', ')}`);
    continue;
  }
  if (replace) dst.json.animations = (dst.json.animations || []).filter((a) => !CLIPS.includes(a.name));
  const done = todo.map((c) => `${c} (${retarget(src, S, dst, D, c)} frames)`);
  writeGlb(f, dst);
  console.log(`${f}: ${done.join(', ')}; clips now ${dst.json.animations.map((a) => a.name).join(', ')}`);
}
