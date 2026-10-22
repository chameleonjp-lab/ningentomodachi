import { Quaternion, Vector3 } from 'three';

/** Fixed-endpoint swing/twist path. Swing transports the anatomical body axis;
 * twist happens about that LOCAL axis, so changing facing does not lift the body
 * as unconstrained shortest SO(3) interpolation can. Endpoints never move. */
export function fixedSwingTwistPath(
  start: Quaternion,
  end: Quaternion,
  localUp: Vector3,
): (fraction: number) => Quaternion {
  const first = start.clone().normalize(),
    last = end.clone().normalize();
  const from = localUp.clone().applyQuaternion(first).normalize();
  const to = localUp.clone().applyQuaternion(last).normalize();
  const midpoint = from.clone().add(to);
  if (midpoint.lengthSq() < 1e-16) midpoint.set(1, 0, 0);
  midpoint.normalize();
  // A shortest swing can itself go through standing when two sideways body
  // axes point in opposite horizontal directions. Continuously bend that arc
  // toward a horizontal/downward waypoint instead of classifying actor poses.
  const maximumY = Math.max(from.y, to.y);
  const excess = Math.max(0, midpoint.y - maximumY);
  if (excess > 0 && maximumY < 1) {
    const startHeading = Math.atan2(from.x, from.z);
    const endHeading = Math.atan2(to.x, to.z);
    const delta = Math.atan2(
      Math.sin(endHeading - startHeading),
      Math.cos(endHeading - startHeading),
    );
    const heading = startHeading + delta / 2;
    const y = Math.min(0, from.y, to.y),
      horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const lower = new Vector3(
      Math.sin(heading) * horizontal,
      y,
      Math.cos(heading) * horizontal,
    );
    midpoint
      .lerp(lower, Math.sqrt(Math.min(1, excess / (1 - maximumY))))
      .normalize();
  }
  const firstSwing = new Quaternion().setFromUnitVectors(from, midpoint);
  const lastSwing = new Quaternion().setFromUnitVectors(midpoint, to);
  const transported = lastSwing.clone().multiply(firstSwing).multiply(first);
  const twist = transported.invert().multiply(last).normalize();
  return (fraction) => {
    const phase = fraction < 0.5 ? fraction * 2 : (fraction - 0.5) * 2;
    const smooth = phase * phase * (3 - 2 * phase);
    const swing =
      fraction < 0.5
        ? new Quaternion().slerp(firstSwing, smooth)
        : new Quaternion().slerp(lastSwing, smooth).multiply(firstSwing);
    return swing
      .multiply(first)
      .multiply(new Quaternion().slerp(twist, fraction))
      .normalize();
  };
}
