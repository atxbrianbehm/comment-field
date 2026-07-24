fn card_wobble(
  local_position: vec3f,
  card_uv: vec2f,
  bend: f32,
  card_height: f32,
) -> vec3f {
  let bend_active = abs(bend) > 0.00001;
  let safe_bend = max(abs(bend), 0.00001);
  let bend_sign = select(-1.0, 1.0, bend >= 0.0);
  let from_anchor = clamp(card_uv.y, 0.0, 1.0);
  let angle = from_anchor * safe_bend;
  let radius = card_height / safe_bend;
  let bent_y = -card_height * 0.5 + sin(angle) * radius;
  let bent_z = (1.0 - cos(angle)) * radius * bend_sign;
  return vec3f(
    local_position.x,
    select(local_position.y, bent_y, bend_active),
    select(local_position.z, local_position.z + bent_z, bend_active),
  );
}
