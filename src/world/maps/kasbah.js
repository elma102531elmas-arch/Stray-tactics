// Default map: "Kasbah" — an original sun-baked desert town for 5v5 TDM.
// Three lanes (market street / mid arch / covered east tunnel) connecting two
// spawn plazas. Written with tiny helpers but the output is plain JSON, the
// same format the Map Editor saves/exports.

export function makeKasbah() {
  const O = [];
  let seed = 10;
  const B = (x0, z0, x1, z1, h, mat, o = {}) => O.push({
    type: 'building', pos: [(x0 + x1) / 2, 0, (z0 + z1) / 2], size: [x1 - x0, h, z1 - z0], rot: 0, mat,
    trim: o.trim || 'sandstone', seed: ++seed, windows: o.windows ?? 0.6, beams: o.beams ?? true, door: o.door ?? true,
    doorSide: o.doorSide ?? 0, parapet: o.parapet ?? true,
  });
  const P = (prop, x, z, rot = 0, extra = {}) => O.push({ type: 'prop', prop, pos: [x, extra.y || 0, z], rot, scale: extra.scale || 1, ...(extra.variant ? { variant: extra.variant } : {}) });
  const BOX = (x, y, z, w, h, d, mat, rot = 0) => O.push({ type: 'box', pos: [x, y, z], size: [w, h, d], rot, mat });

  // ---------------- perimeter (outer town walls) ----------------
  // west strip (faces +x => doorSide 2)
  B(-41, -44, -33, -26, 10, 'plaster', { doorSide: 2 });
  B(-41, -26, -33.5, -9, 8.5, 'plaster_ochre', { doorSide: 2 });
  B(-41, -9, -33, 9, 11, 'sandstone', { doorSide: 2, windows: 0.4 });
  B(-41, 9, -33.5, 25, 9, 'plaster_blue', { doorSide: 2 });
  B(-41, 25, -33, 44, 10, 'plaster', { doorSide: 2 });
  // east strip (faces -x => doorSide 3)
  B(33, -44, 41, -24, 9.5, 'plaster_ochre', { doorSide: 3 });
  B(33.5, -24, 41, -12, 11, 'plaster', { doorSide: 3 });
  B(33, -12, 41, 10, 8, 'sandstone', { doorSide: 3, windows: 0.3 });
  B(33.5, 10, 41, 26, 10, 'plaster_blue', { doorSide: 3 });
  B(33, 26, 41, 44, 9, 'plaster', { doorSide: 3 });
  // north strip (faces +z => doorSide 0)
  B(-33, -44, -14, -35, 9, 'plaster', { doorSide: 0 });
  B(-14, -44, 6, -35.5, 11, 'sandstone', { doorSide: 0, windows: 0.5 });
  B(6, -44, 33, -35, 9.5, 'plaster_ochre', { doorSide: 0 });
  // south strip (faces -z => doorSide 1)
  B(-33, 35, -10, 44, 10, 'plaster_ochre', { doorSide: 1 });
  B(-10, 35.5, 12, 44, 8.5, 'plaster', { doorSide: 1 });
  B(12, 35, 33, 44, 11, 'sandstone', { doorSide: 1, windows: 0.5 });

  // ---------------- inner blocks ----------------
  // west blocks
  B(-21, -24, -14, -6, 8, 'plaster_ochre', { doorSide: 3 });
  B(-14, -24, -7, -6, 6.5, 'plaster', { doorSide: 2 });
  B(-21, 6, -13, 24, 7, 'plaster', { doorSide: 3 });
  B(-13, 6, -7, 24, 8.5, 'sandstone', { doorSide: 2, windows: 0.5 });
  B(-18, -2, -10, 2, 4, 'plaster_blue', { parapet: false, doorSide: 0, beams: false, windows: 0.3 });
  // east blocks
  B(7, -24, 14, -4, 7.5, 'plaster', { doorSide: 3 });
  B(14, -24, 21, -4, 9, 'plaster_ochre', { doorSide: 2 });
  B(7, 8, 13, 24, 8.5, 'plaster_blue', { doorSide: 3 });
  B(13, 8, 21, 24, 7, 'plaster', { doorSide: 2 });
  B(10, 0, 18, 4, 3.5, 'sandstone', { parapet: false, beams: false, doorSide: 1, windows: 0.2 });

  // ---------------- mid ----------------
  O.push({ type: 'arch', pos: [0, 0, 0], size: [20, 6.5, 1.4], rot: 0, mat: 'sandstone', open: [4.2, 4.4], trim: 'sandstone' });
  BOX(0, 0, -0.95, 20.2, 0.25, 0.5, 'sandstone'); BOX(0, 0, 0.95, 20.2, 0.25, 0.5, 'sandstone');
  O.push({ type: 'cyl', pos: [-2.5, 0, -1.2], size: [0.7, 4.4, 0.7], mat: 'sandstone' });
  O.push({ type: 'cyl', pos: [2.5, 0, -1.2], size: [0.7, 4.4, 0.7], mat: 'sandstone' });
  // mid floor pavers
  BOX(0, 0, 0, 14, 0.04, 48, 'pavers');
  P('crate_stack', -4.6, 5.5, 8);
  P('crate', 4.2, -5.2, -14);
  P('crate_small', 5.2, -4.2, 20);
  P('car', 3.6, 15, 12, { variant: 'rust' });
  P('sandbags', -3.2, -13, 0);
  P('sandbags', -4.8, -14.2, 90);
  P('barrel', 5.6, 20.5, 0); P('barrel', 6.2, 21.2, 0, { variant: 'rust' });
  P('crate', -5.4, 19, 30);
  P('rubble', 1.5, -9, 0);
  P('pot', -6.3, 9.5); P('pot', -6.4, 10.4, 0, { scale: 0.8 });
  P('lamp', 6.4, -16, -90);
  P('lamp', -6.4, 16, 90);
  P('barrier', 1.2, -20.5, 8); P('barrier', -1.0, 21.8, -6);
  P('barrel_wood', -5.9, 12.2); P('jug', -6.1, 8.6);
  P('mil_crates', 5.7, -10.5, 75);

  // ---------------- west market street ----------------
  BOX(-27, 0, 0, 12, 0.04, 50, 'tiles');
  P('stall', -31.4, 15, 90);
  P('stall', -31.4, 6, 90);
  P('stall', -31.4, -14, 90);
  P('awning', -31.9, 0.5, 90, { variant: 'blue' });
  P('palm', -22.5, 18.5); P('palm', -23, -16.5); P('palm', -30.5, 23);
  P('crate', -24, 10, 10); P('crate_small', -23.2, 11.1, -12);
  P('crate_stack', -29.5, -5, -6);
  P('barrel', -22.4, -2.5); P('barrel', -22.2, -3.4, 0, { variant: 'rust' });
  P('pot', -32.3, 10.6); P('pot', -32.4, 11.4, 0, { scale: 0.75 }); P('pot', -32.2, -9.3);
  P('pallet', -25.5, -20, 20);
  P('tires', -24, 2.2);
  P('barrel_wood', -22.6, 6.6); P('barrel_wood', -30.4, -18.2);
  P('jug', -30.6, 9.9); P('jug', -30.3, -11.2);
  P('clutter', -23.5, -12.5, 80);
  // stairs to the low roof (vantage over west connectors)
  O.push({ type: 'stairs', pos: [-21.2, 0, 0], size: [2.6, 4, 6.2], rot: -90, mat: 'sandstone', steps: 12 });

  // ---------------- east covered tunnel ----------------
  BOX(27, 4.2, -2, 12.6, 0.5, 21, 'concrete');
  for (let z = -11.5; z <= 8; z += 4.8) {
    O.push({ type: 'cyl', pos: [21.7, 0, z], size: [0.7, 4.2, 0.7], mat: 'sandstone' });
    O.push({ type: 'cyl', pos: [32.3, 0, z], size: [0.7, 4.2, 0.7], mat: 'sandstone' });
  }
  for (let z = -11; z <= 8; z += 2.6) BOX(27, 3.9, z, 12.4, 0.3, 0.26, 'wood');
  BOX(27, 0, -2, 11, 0.04, 21, 'concrete');
  P('crate', 24, -6.5, 5); P('crate_small', 30.6, 2.5, -20); P('crate', 30.2, -9.8, 0);
  P('barrel', 23.2, 4.8); P('barrel', 31.6, -3.5, 0, { variant: 'rust' });
  P('sandbags', 27, 10.5, 0);
  P('pallet', 31.5, 6.8, 40);
  P('mil_crates', 24.6, 1.6, 10); P('mil_crates', 30.8, -6.6, -80);
  P('clutter', 23.4, -9.2, 90);
  P('barrier', 27, -12.6, 0);

  // ---------------- north plaza (team 1 spawn) ----------------
  BOX(0, 0, -29.5, 20, 0.04, 11, 'pavers');
  P('well', -25, -29.5, 15);
  P('sandbags', -17.5, -27, 0); P('sandbags', -15.3, -27.8, 35);
  P('crate_stack', -29, -26.5, 4);
  P('crate', 14.5, -28, -8); P('crate_small', 15.7, -27, 14);
  P('car', 25.5, -29.5, 82, { variant: 'metal' });
  P('palm', -9, -33.4); P('palm', 9.5, -33.2);
  P('barrel', 30.5, -33.5); P('barrel', 31.3, -32.8, 0, { variant: 'rust' });
  P('rubble', -31, -33, 0);
  P('lamp', -11.5, -25.5, 180);
  P('barrier', 5.5, -25.2, 4); P('clutter', 22.6, -32.2, 30); P('barrel_wood', -21.5, -32.5);

  // ---------------- south plaza (team 0 spawn) ----------------
  BOX(0, 0, 29.5, 20, 0.04, 11, 'pavers');
  P('well', 24.5, 29.5, -20);
  P('sandbags', 17.5, 27, 0); P('sandbags', 15.4, 27.9, -35);
  P('crate_stack', 29, 26.4, -4);
  P('crate', -14.5, 28, 8); P('crate_small', -15.8, 27, -14);
  P('stall', -27.5, 33.6, 180);
  P('palm', -9.5, 33.4); P('palm', 9, 33.3);
  P('barrel', -30.6, 26.5); P('pot', -31.8, 27.3);
  P('rubble', 31, 33, 0);
  P('lamp', 11.5, 25.5, 0);
  P('barrier', -5.5, 25.2, -4); P('clutter', -26.2, 28.4, 200); P('mil_crates', 21.4, 32.2, 20);

  // ---------------- spawns ----------------
  for (let i = 0; i < 6; i++) {
    O.push({ type: 'spawn', team: 0, pos: [-7.5 + i * 3, 0, 30 + (i % 2) * 2.5], rot: 0 });
    O.push({ type: 'spawn', team: 1, pos: [-7.5 + i * 3, 0, -30 - (i % 2) * 2.5], rot: 180 });
  }

  return {
    format: 'strikepoint-map', version: 1,
    name: 'Kasbah', author: 'built-in', seed: 7,
    bounds: [-33, -35, 33, 35],
    ground: 'sand',
    atmos: {},
    objects: O,
  };
}
