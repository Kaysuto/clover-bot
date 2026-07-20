/**
 * Convention des customId : "prefix:action:arg1:arg2..."
 * Le préfixe route vers le module (voir src/components.ts).
 */
export function buildId(
  prefix: string,
  action: string,
  ...args: Array<string | number>
): string {
  return [prefix, action, ...args].join(":");
}

export function parseId(customId: string): {
  prefix: string;
  action: string;
  args: string[];
} {
  const [prefix = "", action = "", ...args] = customId.split(":");
  return { prefix, action, args };
}
