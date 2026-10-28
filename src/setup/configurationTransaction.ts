export interface ConfigurationEdit {
  key: string;
  target: 'global' | 'workspace' | 'folder';
  before: unknown;
  after: unknown;
}

/** Apply only setup-owned keys. Roll back in reverse order on a failed final check. */
export async function configureTransaction(
  edits: readonly ConfigurationEdit[],
  write: (edit: ConfigurationEdit, value: unknown) => Promise<void>,
  verify: () => Promise<void>,
  read?: (edit: ConfigurationEdit) => unknown,
): Promise<void> {
  const applied: ConfigurationEdit[] = [];
  try {
    for (const edit of edits) {
      if (read && read(edit) !== edit.before) { throw new Error(`SETUP_CONFIGURATION_CHANGED ${edit.key}`); }
      applied.push(edit);
      await write(edit, edit.after);
    }
    await verify();
  } catch (error) {
    const failures: string[] = [];
    for (const edit of applied.reverse()) {
      if (read && read(edit) !== edit.after && read(edit) !== edit.before) {
        failures.push(`${edit.target}:${edit.key}:changed`);
        continue;
      }
      try { await write(edit, edit.before); }
      catch { failures.push(`${edit.target}:${edit.key}`); }
    }
    if (failures.length) {
      throw new Error(`SETUP_ROLLBACK_FAILED ${failures.join(', ')}; ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    throw error;
  }
}
