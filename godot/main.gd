extends Node3D
## Fireball port (P5): the web fireball rebuilt with Godot 4 GPUParticles3D.
## Every number comes from docs/METHOD.md section 1 (the web version's own table), so the two engines can be
## compared side by side. Textures are the web atlas sheets exported by scripts/export_atlas.mjs.
## The scene loops: a fireball flies left to right for 0.7 s, explodes, and a new one starts 1.8 s later.

const SPEED := 19.0          # web: flight speed 19
const FLIGHT := 0.7          # seconds of flight before the scripted hit
const LOOP := 1.8            # seconds per cycle
const START := Vector3(-6.65, 1.15, 0.0)
const ORANGE := Color8(255, 122, 46)

var tex := {}
var ball: Node3D
var core: GPUParticles3D
var glow: GPUParticles3D
var trail: GPUParticles3D
var tongues: GPUParticles3D
var embers: GPUParticles3D
var light: OmniLight3D
var blast: Array[GPUParticles3D] = []
var t := 0.0
var flash_light: OmniLight3D
var flash_t := 0.0
var exploded := false


func _ready() -> void:
	for n in ["flame", "explosion", "smoke", "glow"]:
		# load the PNG directly so the project runs without an editor import step
		tex[n] = ImageTexture.create_from_image(Image.load_from_file("res://textures/%s.png" % n))
	_world()
	_build_ball()
	_build_blast()


func _world() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color8(9, 11, 17)            # web clear colour 0x090b11
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.35, 0.37, 0.48)
	e.ambient_light_energy = 0.6
	e.fog_enabled = true
	e.fog_light_color = Color8(11, 14, 22)            # web FogExp2 0x0b0e16, density 0.026
	e.fog_density = 0.026
	env.environment = e
	add_child(env)
	var cam := Camera3D.new()
	cam.fov = 42.0                                     # web PerspectiveCamera(42)
	cam.position = Vector3(0, 18.5, 11.0)              # web camera offset from the player
	add_child(cam)
	cam.look_at(Vector3.ZERO)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new(); pm.size = Vector2(60, 60)
	ground.mesh = pm
	var gm := StandardMaterial3D.new(); gm.albedo_color = Color8(38, 36, 44); gm.roughness = 1.0
	ground.material_override = gm
	add_child(ground)


func _mat(name: String, col: Color, additive := true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if additive else BaseMaterial3D.BLEND_MODE_MIX
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES   # camera-facing quads, like the web PSys
	m.particles_anim_h_frames = 4                           # the 4x4 flipbook
	m.particles_anim_v_frames = 4
	m.particles_anim_loop = true
	m.albedo_texture = tex[name]
	m.albedo_color = col
	m.vertex_color_use_as_albedo = true                     # colour ramp drives the fade
	m.no_depth_test = false
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	return m


func _fade(a0: float, a1: float) -> GradientTexture1D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, a0))
	g.set_color(1, Color(1, 1, 1, a1))
	var gt := GradientTexture1D.new(); gt.gradient = g
	return gt


func _shrink(ratio: float) -> CurveTexture:
	var c := Curve.new()
	c.max_value = max(1.0, ratio)  # a Curve tops out at 1 by default, which would cap growth (explosion 2.5 -> 3.7)
	c.add_point(Vector2(0, 1)); c.add_point(Vector2(1, ratio))
	var ct := CurveTexture.new(); ct.curve = c
	return ct


## One emitter. rate: particles per second (amount = rate x lifetime, as in engine-mapping.md).
func _emitter(o: Dictionary) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	var life: float = o.get("life", 0.5)
	p.lifetime = life
	p.amount = max(1, int(round(o.get("rate", 10.0) * life))) if not o.has("count") else o["count"]
	p.one_shot = o.get("one_shot", false)
	p.explosiveness = o.get("explosive", 0.0)
	p.local_coords = o.get("local", false)
	p.fixed_fps = 0                                    # docs: fixed FPS steps the flipbook; 0 = smooth
	p.visibility_aabb = AABB(Vector3(-20, -5, -20), Vector3(40, 20, 40))
	var m := ParticleProcessMaterial.new()
	m.lifetime_randomness = o.get("life_rand", 0.0)
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = o.get("radius", 0.05)
	m.direction = o.get("dir", Vector3.UP)
	m.spread = o.get("spread", 180.0)
	m.initial_velocity_min = o.get("v_min", 0.0)
	m.initial_velocity_max = o.get("v_max", 0.0)
	m.gravity = o.get("gravity", Vector3.ZERO)
	m.damping_min = o.get("drag", 0.0)
	m.damping_max = o.get("drag", 0.0)
	m.scale_min = o.get("s_min", 1.0)
	m.scale_max = o.get("s_max", 1.0)
	m.scale_curve = _shrink(o.get("shrink", 1.0))
	m.color_ramp = _fade(o.get("a0", 1.0), o.get("a1", 0.0))
	m.angle_min = -180.0; m.angle_max = 180.0
	m.angular_velocity_min = o.get("spin_min", 0.0)
	m.angular_velocity_max = o.get("spin_max", 0.0)
	m.anim_speed_min = o.get("anim", 1.0); m.anim_speed_max = o.get("anim", 1.0)
	m.anim_offset_min = o.get("anim_off_min", 0.0); m.anim_offset_max = o.get("anim_off_max", 1.0)
	p.process_material = m
	var q := QuadMesh.new(); q.size = Vector2.ONE
	q.material = _mat(o.get("tex", "flame"), o.get("col", Color.WHITE), o.get("additive", true))
	p.draw_pass_1 = q
	return p


func _build_ball() -> void:
	ball = Node3D.new(); add_child(ball)
	# core: 3 flame flipbooks stacked, sizes 0.7-1.05, spinning, 20-30 fps (web: 1.05/0.85/0.7, 24/30/20 fps)
	core = _emitter({"count": 3, "life": 1.0, "explosive": 1.0, "local": true, "radius": 0.02, "s_min": 0.7, "s_max": 1.05,
		"spin_min": -183.0, "spin_max": 235.0, "anim": 24.0 / 16.0, "a0": 1.0, "a1": 1.0, "col": Color(1, 0.85, 0.6)})
	ball.add_child(core)
	# glow: one soft dot, size 2.6, orange, alpha 0.32
	glow = _emitter({"count": 1, "life": 1.0, "explosive": 1.0, "local": true, "radius": 0.0, "s_min": 2.6, "s_max": 2.6,
		"tex": "glow", "anim": 0.0, "anim_off_min": 0.0, "anim_off_max": 0.0, "a0": 0.32, "a1": 0.32, "col": ORANGE})
	ball.add_child(glow)
	# trail: 240 per second, 0.10-0.16 s, 0.5-0.66 -> 0.05, random 0.4, stays in world space
	trail = _emitter({"rate": 240.0, "life": 0.16, "life_rand": 0.375, "s_min": 0.5, "s_max": 0.66, "shrink": 0.08,
		"v_min": 0.0, "v_max": 0.4, "anim": 24.0 * 0.13 / 16.0, "col": Color(1, 0.7, 0.4)})
	ball.add_child(trail)
	# tongues: 70 per second, 0.2-0.3 s, 0.6 -> 0.18, random direction 1.6, slightly up
	tongues = _emitter({"rate": 70.0, "life": 0.3, "life_rand": 0.33, "s_min": 0.6, "s_max": 0.6, "shrink": 0.3,
		"dir": Vector3(0, 1, 0), "spread": 120.0, "v_min": 0.8, "v_max": 1.6, "anim": 0.4, "col": Color(1, 0.8, 0.5)})
	ball.add_child(tongues)
	# embers: 35 per second, 0.5-0.9 s, 0.14 -> 0.04, drifting up, drag 1.2
	embers = _emitter({"rate": 35.0, "life": 0.9, "life_rand": 0.44, "s_min": 0.14, "s_max": 0.14, "shrink": 0.29,
		"dir": Vector3.UP, "spread": 35.0, "v_min": 0.6, "v_max": 1.4, "drag": 1.2, "tex": "glow", "anim": 0.0,
		"anim_off_min": 0.5, "anim_off_max": 0.99, "col": Color(1, 0.6, 0.25)})  # glow frames 9-16, the small dots
	ball.add_child(embers)
	# following light: orange 0xff7a2e, energy 2.3, range 8
	light = OmniLight3D.new(); light.light_color = ORANGE; light.light_energy = 2.3; light.omni_range = 8.0
	ball.add_child(light)


func _build_blast() -> void:
	var specs := [
		# explosion: 3 flipbooks played once over 0.45-0.62 s, 2.5 -> 3.7
		{"count": 3, "life": 0.62, "life_rand": 0.27, "explosive": 1.0, "one_shot": true, "s_min": 2.5, "s_max": 2.5, "shrink": 1.48,
			"tex": "explosion", "anim": 1.0, "anim_off_min": 0.0, "anim_off_max": 0.0, "a0": 1.0, "a1": 1.0},
		# flash: 1 quad, 0.14 s, 5 -> 6.5
		{"count": 1, "life": 0.14, "explosive": 1.0, "one_shot": true, "s_min": 5.0, "s_max": 5.0, "shrink": 1.3, "tex": "glow",
			"anim": 0.0, "anim_off_min": 0.0, "anim_off_max": 0.0, "a0": 0.9, "a1": 0.0, "col": Color(1, 0.75, 0.4)},
		# sparks: 40, 0.45-0.9 s, 0.22 -> 0.05, speed 5-12, gravity 16, drag 1.4 (the web version also bounces off the ground)
		{"count": 40, "life": 0.9, "life_rand": 0.5, "explosive": 1.0, "one_shot": true, "s_min": 0.22, "s_max": 0.22, "shrink": 0.23,
			"dir": Vector3.UP, "spread": 84.0, "v_min": 5.0, "v_max": 12.0, "gravity": Vector3(0, -16, 0), "drag": 1.4, "tex": "glow", "anim": 0.0,
			"anim_off_min": 0.5, "anim_off_max": 0.99, "col": Color(1, 0.75, 0.35)},  # web: frame 8 + randi(0, 7)
		# smoke: 6 puffs, normal blending, 1.1-1.8 s, 1.4 -> 3.6, up 0.6-1.4, alpha 0.55 -> 0
		{"count": 6, "life": 1.8, "life_rand": 0.39, "explosive": 1.0, "one_shot": true, "s_min": 1.4, "s_max": 1.4, "shrink": 2.57,
			"dir": Vector3.UP, "spread": 25.0, "v_min": 0.6, "v_max": 1.4, "tex": "smoke", "additive": false, "anim": 1.0,
			"anim_off_min": 0.0, "anim_off_max": 0.0, "a0": 0.55, "a1": 0.0, "col": Color(0.5, 0.46, 0.44)},
	]
	flash_light = OmniLight3D.new(); flash_light.light_color = Color8(255, 138, 58); flash_light.omni_range = 10.0
	flash_light.light_energy = 0.0; add_child(flash_light)
	for s in specs:
		var p := _emitter(s)
		p.emitting = false
		add_child(p)
		blast.append(p)


func _process(delta: float) -> void:
	t += delta
	if t >= LOOP:
		t -= LOOP
		exploded = false
		for n in [core, glow, light]:
			n.visible = true
		for p in [core, trail, tongues, embers]:
			p.restart()
	if t < FLIGHT:
		ball.position = START + Vector3(SPEED * t, 0, 0)
	elif not exploded:
		exploded = true
		for n in [core, glow, light]:
			n.visible = false  # the trail keeps fading in the air, as on the web
		for p in [trail, tongues, embers]:
			p.emitting = false
		for p in blast:
			p.global_position = ball.position
			p.restart()
		flash_light.position = ball.position + Vector3(0, 0.6, 0)
		flash_t = 0.4
	if flash_t > 0.0:
		flash_t = max(0.0, flash_t - delta)
		flash_light.light_energy = 4.5 * flash_t / 0.4
