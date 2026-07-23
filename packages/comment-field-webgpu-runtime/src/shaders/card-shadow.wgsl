fn compose_card_shadow(
  center: vec4<f32>,
  positive_x: vec4<f32>,
  negative_x: vec4<f32>,
  positive_y: vec4<f32>,
  negative_y: vec4<f32>,
  shadow_red: f32,
  shadow_green: f32,
  shadow_blue: f32,
  opacity_amount: f32
) -> vec4<f32> {
  let alpha = center.a * 0.36
    + positive_x.a * 0.16
    + negative_x.a * 0.16
    + positive_y.a * 0.16
    + negative_y.a * 0.16;
  return vec4<f32>(
    vec3<f32>(shadow_red, shadow_green, shadow_blue),
    alpha * opacity_amount
  );
}
