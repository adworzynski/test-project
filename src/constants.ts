/** GitHub Action that runs `keel verify` on pull requests (VG-4). Override with KEEL_ACTION_REF at init. */
export const ACTION_REF = process.env.KEEL_ACTION_REF ?? 'adworzynski/test-project/verify@main';
