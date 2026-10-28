/**
 * Errors shared across the service layer.
 *
 * `ValidationError` used to live in `account.ts`, which every other service imports it
 * from. That made `account.ts` un-importable *by* a service without a cycle — and the
 * account service genuinely needs to reach into other modules when a consent is
 * withdrawn, because withdrawal is destructive. Keeping the error here is what lets that
 * call happen in the honest direction: the module that owns the data exposes the purge,
 * and the consent toggle calls it.
 */
export class ValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}
