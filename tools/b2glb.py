"""Convert a model (.blend/.fbx/.obj/.gltf/.glb/.stl) to GLB with Blender (bpy) and print a report.

usage: bpyenv/bin/python -I b2glb.py <input> <output.glb> [--all] [--keep REGEX] [--drop REGEX] [--noapply]
  default: export only visible objects (use --all to export everything)
  --keep/--drop: regex on object names (applied after visibility filter)
Never runs scripts embedded in .blend files (use_scripts=False, auto-exec off).
"""
import sys, os, re, json
import bpy

args = sys.argv[1:]
src, out = args[0], args[1]
flags = args[2:]
export_all = '--all' in flags
noapply = '--noapply' in flags
keep = drop = None
if '--keep' in flags:
    keep = re.compile(flags[flags.index('--keep') + 1])
if '--drop' in flags:
    drop = re.compile(flags[flags.index('--drop') + 1])

bpy.context.preferences.filepaths.use_scripts_auto_execute = False
ext = os.path.splitext(src)[1].lower()
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=src, load_ui=False, use_scripts=False)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    if ext == '.fbx':
        try:
            bpy.ops.import_scene.fbx(filepath=src, use_image_search=True)
        except RuntimeError as e:
            print('legacy fbx importer failed (%s); using wm.fbx_import (ufbx)' % e)
            bpy.ops.wm.fbx_import(filepath=src)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=src)
    elif ext in ('.gltf', '.glb'):
        bpy.ops.import_scene.gltf(filepath=src)
    elif ext == '.stl':
        bpy.ops.wm.stl_import(filepath=src)
    elif ext == '.dae':
        bpy.ops.wm.collada_import(filepath=src)
    else:
        raise SystemExit('unknown ext ' + ext)

# ---- relink missing images by basename search near the source file
root = os.path.dirname(os.path.abspath(src))
search_roots = [root, os.path.dirname(root)]
index = {}
for sr in search_roots:
    for dp, dn, fn in os.walk(sr):
        for f in fn:
            index.setdefault(f.lower(), os.path.join(dp, f))
for img in bpy.data.images:
    if img.source != 'FILE' or img.packed_file:
        continue
    p = bpy.path.abspath(img.filepath, library=img.library)
    if not os.path.exists(p):
        base = os.path.basename(p.replace('\\', '/')).lower()
        if base in index:
            img.filepath = index[base]
            img.reload()
            print('RELINK', img.name, '->', index[base])
        else:
            print('MISSING IMAGE', img.name, p)

# ---- optional material overrides: --mat "OBJREGEX=base:path,normal:path,metal:path,rough:path,gloss:path,ao:path,orm:path,metalv:0.5,roughv:0.5"
def occlusion_group():
    ng = bpy.data.node_groups.get('glTF Material Output')
    if ng:
        return ng
    ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return ng


def load_img(path, noncolor):
    if path.startswith('@'):
        img = bpy.data.images[path[1:]]
    else:
        p = path if os.path.isabs(path) else os.path.join(root, path)
        img = bpy.data.images.load(p, check_existing=True)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    return img


def invert_to_file(path, use_alpha=False):
    import numpy as np
    img = load_img(path, True)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    if use_alpha:
        a = 1.0 - px[:, 3].copy()
        px[:, 0] = a; px[:, 1] = a; px[:, 2] = a; px[:, 3] = 1.0
    else:
        px[:, :3] = 1.0 - px[:, :3]
    w, h = img.size
    new = bpy.data.images.new(os.path.basename(path) + '_inv', w, h, alpha=False, float_buffer=False)
    new.colorspace_settings.name = 'Non-Color'
    new.pixels[:] = px.ravel()
    outp = os.path.join(os.path.dirname(os.path.abspath(out)), 'work', os.path.splitext(os.path.basename(path))[0] + '_rough.png')
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    new.filepath_raw = outp
    new.file_format = 'PNG'
    new.save()
    return outp


def flip_green_to_file(path):
    import numpy as np
    img = load_img(path, True)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    px[:, 1] = 1.0 - px[:, 1]
    px[:, 3] = 1.0
    w, h = img.size
    new = bpy.data.images.new(os.path.basename(path) + '_gl', w, h, alpha=False, float_buffer=False)
    new.colorspace_settings.name = 'Non-Color'
    new.pixels[:] = px.ravel()
    outp = os.path.join(os.path.dirname(os.path.abspath(out)), 'work', os.path.splitext(os.path.basename(path))[0] + '_GL.png')
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    new.filepath_raw = outp
    new.file_format = 'PNG'
    new.save()
    return outp


def make_mat(name, spec):
    if 'normaldx' in spec:
        spec['normal'] = flip_green_to_file(spec['normaldx'])
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    x = -700
    def tex(key, noncolor):
        nonlocal x
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = load_img(spec[key], noncolor)
        n.location = (x, 300 - 300 * len([k for k in spec if k in ('base', 'normal', 'metal', 'rough', 'ao', 'orm')]))
        x += 10
        return n
    if 'base' in spec:
        t = tex('base', False)
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if spec.get('alpha') == '1':
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    if 'normal' in spec:
        t = tex('normal', True)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if 'gloss' in spec:
        spec['rough'] = invert_to_file(spec['gloss'])
    if 'glossa' in spec:
        spec['rough'] = invert_to_file(spec['glossa'], use_alpha=True)
    if 'orm' in spec:
        t = tex('orm', True)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = occlusion_group()
        nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    if 'metal' in spec:
        t = tex('metal', True)
        nt.links.new(t.outputs['Color'], bsdf.inputs['Metallic'])
    if 'rough' in spec:
        t = tex('rough', True)
        nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
    if 'ao' in spec:
        t = tex('ao', True)
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = occlusion_group()
        nt.links.new(t.outputs['Color'], g.inputs['Occlusion'])
    if 'metalv' in spec:
        bsdf.inputs['Metallic'].default_value = float(spec['metalv'])
    if 'roughv' in spec:
        bsdf.inputs['Roughness'].default_value = float(spec['roughv'])
    if 'color' in spec:
        c = [float(v) for v in spec['color'].split('/')]
        bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1)
    return m


# bump nodes are not exportable: route the normal map that feeds a Bump straight into the BSDF
for m in bpy.data.materials:
    if not (m.use_nodes and m.node_tree):
        continue
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED' and n.inputs['Normal'].is_linked:
            src_node = n.inputs['Normal'].links[0].from_node
            if src_node.type == 'BUMP':
                nin = src_node.inputs['Normal']
                for l in list(n.inputs['Normal'].links):
                    nt.links.remove(l)
                if nin.is_linked:
                    nt.links.new(nin.links[0].from_socket, n.inputs['Normal'])
                print('FIXBUMP', m.name)

i = 0
while '--mat' in flags[i:]:
    i = flags.index('--mat', i) + 1
    rx, specs = flags[i].split('=', 1)
    spec = dict(kv.split(':', 1) for kv in specs.split(','))
    mat = make_mat('M_' + re.sub(r'\W', '', rx)[:20], spec)
    rxc = re.compile(rx)
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and (rxc.search(ob.name) or any(ms.material and rxc.search(ms.material.name) for ms in ob.material_slots)):
            if rxc.search(ob.name) or not ob.material_slots:
                ob.data.materials.clear()
                ob.data.materials.append(mat)
            else:
                for ms in ob.material_slots:
                    if ms.material and rxc.search(ms.material.name):
                        ms.material = mat
            print('MAT', mat.name, '->', ob.name)

# ---- report
rep = {'objects': [], 'materials': [], 'images': [], 'actions': [a.name for a in bpy.data.actions]}
dg = bpy.context.evaluated_depsgraph_get()
for ob in bpy.data.objects:
    d = {'name': ob.name, 'type': ob.type, 'visible': ob.visible_get() if ob.name in bpy.context.view_layer.objects else False,
         'hide_render': ob.hide_render, 'parent': ob.parent.name if ob.parent else None,
         'collections': [c.name for c in ob.users_collection],
         'dims': [round(x, 4) for x in ob.dimensions], 'loc': [round(x, 4) for x in ob.matrix_world.translation]}
    if ob.type == 'MESH':
        me = ob.data
        d['verts'] = len(me.vertices)
        d['tris'] = sum(len(p.vertices) - 2 for p in me.polygons)
        d['materials'] = [m.name if m else None for m in me.materials]
        d['uv'] = [u.name for u in me.uv_layers]
        d['modifiers'] = [(m.type, m.name) for m in ob.modifiers]
        d['vgroups'] = len(ob.vertex_groups)
    if ob.type == 'ARMATURE':
        d['bones'] = [b.name for b in ob.data.bones]
    rep['objects'].append(d)
for m in bpy.data.materials:
    md = {'name': m.name, 'use_nodes': m.use_nodes, 'tex': []}
    if m.use_nodes and m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                links = [(l.to_node.type, l.to_socket.name) for o in n.outputs for l in o.links]
                md['tex'].append({'image': n.image.name, 'links': links})
            if n.type == 'BSDF_PRINCIPLED':
                md['bsdf'] = {s.name: (list(s.default_value)[:4] if hasattr(s.default_value, '__len__') else s.default_value)
                              for s in n.inputs if s.name in ('Base Color', 'Metallic', 'Roughness') and not s.is_linked}
    rep['materials'].append(md)
for img in bpy.data.images:
    rep['images'].append({'name': img.name, 'file': img.filepath, 'size': list(img.size), 'packed': bool(img.packed_file)})

# ---- selection for export
sel = []
for ob in bpy.context.view_layer.objects:
    vis = ob.visible_get() and not ob.hide_render
    if not export_all and not vis:
        continue
    if ob.type in ('LIGHT', 'CAMERA', 'SPEAKER', 'LIGHT_PROBE'):
        continue
    if keep and not keep.search(ob.name) and ob.type == 'MESH':
        continue
    if drop and drop.search(ob.name):
        continue
    sel.append(ob)
for ob in bpy.context.view_layer.objects:
    try:
        ob.hide_set(False)
        ob.select_set(ob in sel)
    except Exception as e:
        print('select fail', ob.name, e)
rep['exported'] = [o.name for o in sel]
print(json.dumps(rep, indent=1, default=str))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=not noapply,
                          export_yup=True, export_animations=True, export_skins=True, export_image_format='AUTO')
print('WROTE', out, os.path.getsize(out))
