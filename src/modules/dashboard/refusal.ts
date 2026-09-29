/** Refus motivé d'une opération du dashboard : le message est montré tel quel à l'utilisateur. */
export class Refusal extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
