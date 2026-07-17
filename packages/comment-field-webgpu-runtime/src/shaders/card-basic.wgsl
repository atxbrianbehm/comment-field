fn compose_basic_card(
  center: vec4<f32>,
  card_uv: vec2<f32>,
  selected_amount: f32,
  hero_amount: f32,
  opacity_amount: f32
) -> vec4<f32> {
  let edge = select(0.0, 1.0, card_uv.x <= 0.016)
    + select(0.0, 1.0, card_uv.x >= 0.984)
    + select(0.0, 1.0, card_uv.y <= 0.022)
    + select(0.0, 1.0, card_uv.y >= 0.978);
  let accent = mix(vec3<f32>(0.38, 0.92, 0.76), vec3<f32>(1.0, 0.67, 0.3), hero_amount);
  let highlighted = mix(center.rgb, accent, min(1.0, edge) * max(selected_amount, hero_amount) * center.a);
  return vec4<f32>(highlighted, center.a * opacity_amount);
}
