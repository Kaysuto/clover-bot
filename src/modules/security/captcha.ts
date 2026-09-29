import { randomInt } from "node:crypto";

/**
 * Captcha image : code court rendu en PNG avec lettres pivotées et bruit,
 * assez pour gêner une lecture automatique simple sans gêner un humain.
 */

/** Sans 0/O, 1/I/L : aucun caractère ambigu à l'œil. */
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const WIDTH = 240;
const HEIGHT = 90;

export function randomCode(length = 5): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CHARSET[randomInt(CHARSET.length)];
  return code;
}

export function captchaMatches(expected: string, input: string): boolean {
  return input.trim().toUpperCase().replace(/\s+/g, "") === expected;
}

function color(): string {
  return `rgb(${randomInt(20, 110)},${randomInt(20, 110)},${randomInt(20, 110)})`;
}

export function captchaSvg(code: string): string {
  const noise: string[] = [];
  for (let i = 0; i < 7; i++) {
    noise.push(
      `<line x1="${randomInt(WIDTH)}" y1="${randomInt(HEIGHT)}" x2="${randomInt(WIDTH)}" y2="${randomInt(HEIGHT)}" stroke="${color()}" stroke-width="${randomInt(1, 3)}" opacity="0.6"/>`,
    );
  }
  for (let i = 0; i < 30; i++) {
    noise.push(`<circle cx="${randomInt(WIDTH)}" cy="${randomInt(HEIGHT)}" r="${randomInt(1, 3)}" fill="${color()}" opacity="0.5"/>`);
  }
  const step = WIDTH / (code.length + 1);
  const letters = [...code].map((char, i) => {
    const x = Math.round(step * (i + 1));
    const y = 58 + randomInt(-8, 9);
    return `<text x="${x}" y="${y}" transform="rotate(${randomInt(-28, 29)} ${x} ${y})" font-family="DejaVu Sans, Arial, sans-serif" font-size="${randomInt(38, 48)}" font-weight="bold" fill="${color()}" text-anchor="middle">${char}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><rect width="100%" height="100%" fill="#eef2ee"/>${noise.slice(0, 4).join("")}${letters.join("")}${noise.slice(4).join("")}</svg>`;
}

export async function renderCaptcha(code: string): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(Buffer.from(captchaSvg(code))).png().toBuffer();
}
