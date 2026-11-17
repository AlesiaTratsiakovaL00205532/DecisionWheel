export const ANSWERS = Object.freeze(['Yes', 'No', 'Maybe', 'Later']);
export const MAX_QUESTION_LENGTH = 240;

export function targetRotation(currentRotation, index) {
  if (!Number.isInteger(index) || index < 0 || index >= ANSWERS.length) {
    throw new RangeError('Choose an existing wheel sector.');
  }
  const sectorAngle = 360 / ANSWERS.length;
  const target = (360 - index * sectorAngle) % 360;
  const offset = (target - currentRotation % 360 + 360) % 360;
  return currentRotation + 5 * 360 + offset;
}
