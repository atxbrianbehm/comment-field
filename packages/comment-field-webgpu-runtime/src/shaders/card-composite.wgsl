fn compose_card(
  center: vec4<f32>,
  positive_x: vec4<f32>,
  negative_x: vec4<f32>,
  positive_y: vec4<f32>,
  negative_y: vec4<f32>,
  motion_sample_1: vec4<f32>,
  motion_sample_2: vec4<f32>,
  motion_sample_3: vec4<f32>,
  motion_sample_4: vec4<f32>,
  card_uv: vec2<f32>,
  blur_amount: f32,
  motion_amount: f32,
  light_direction_x: f32,
  light_direction_y: f32,
  light_ambient: f32,
  light_intensity: f32,
  light_edge: f32,
  selected_amount: f32,
  hero_amount: f32,
  opacity_amount: f32
) -> vec4<f32> {
  var color = center;
  if (blur_amount > 0.01) {
    color = center * 0.4
      + positive_x * 0.15
      + negative_x * 0.15
      + positive_y * 0.15
      + negative_y * 0.15;
  }
  if (motion_amount > 0.0001) {
    let motion_color = center * 0.28
      + motion_sample_1 * 0.24
      + motion_sample_2 * 0.20
      + motion_sample_3 * 0.16
      + motion_sample_4 * 0.12;
    color = mix(color, motion_color, min(1.0, motion_amount));
  }
  let light_direction = normalize(vec2<f32>(light_direction_x, light_direction_y));
  let light_ramp = dot(card_uv - vec2<f32>(0.5), light_direction);
  let edge_distance = min(min(card_uv.x, 1.0 - card_uv.x), min(card_uv.y, 1.0 - card_uv.y));
  let edge_light = clamp((0.045 - edge_distance) / 0.045, 0.0, 1.0) * light_edge;
  let brightness = max(0.2, light_ambient + light_ramp * light_intensity);
  let lit_color = color.rgb * brightness + vec3<f32>(edge_light);

  let edge = select(0.0, 1.0, card_uv.x <= 0.016)
    + select(0.0, 1.0, card_uv.x >= 0.984)
    + select(0.0, 1.0, card_uv.y <= 0.022)
    + select(0.0, 1.0, card_uv.y >= 0.978);
  let accent = mix(vec3<f32>(0.38, 0.92, 0.76), vec3<f32>(1.0, 0.67, 0.3), hero_amount);
  let highlighted = mix(lit_color, accent, min(1.0, edge) * max(selected_amount, hero_amount) * color.a);
  return vec4<f32>(highlighted, color.a * opacity_amount);
}
