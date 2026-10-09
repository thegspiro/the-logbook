/** The keys of `T` that are optional, i.e. that a value of `T` may omit. */
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];

/**
 * A shallow copy of `value` with `keys` absent.
 *
 * Under `exactOptionalPropertyTypes` an optional field cannot be written as
 * `undefined` — and a response that leaves a field out leaves the key out, so
 * `{ ...fixture, end_time: undefined }` was never the shape the code receives
 * anyway. A fixture modelling "the server sent no end time" removes the key.
 * Only optional keys are accepted: removing a required one would build a value
 * the type says cannot exist.
 */
export function withoutKeys<T extends object, K extends OptionalKeys<T>>(value: T, ...keys: K[]): T {
  const copy = { ...value };
  for (const key of keys) Reflect.deleteProperty(copy, key);
  return copy;
}
