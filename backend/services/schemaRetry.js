// Shared version of the defensive retry pattern that already existed
// independently in routes/progress.js and src/services/settingsService.ts:
// if a write hits a column Postgres/PostgREST doesn't recognize (a schema
// migration that was never applied - see DEPLOYMENT.md), drop that column
// from the payload and retry, one column at a time, instead of hard-failing
// the whole request. A genuinely broken write (bad auth, real constraint
// violation, missing row) still surfaces normally - only the
// missing-column error class is treated as retryable.

const isMissingColumnError = (error) =>
  !!error && (
    error.code === 'PGRST204'
    || error.code === '42703'
    || String(error?.message || '').toLowerCase().includes('could not find')
    || String(error?.message || '').toLowerCase().includes('schema cache')
  );

const getMissingColumnName = (error) => {
  const message = String(error?.message || '');
  const details = String(error?.details || '');
  return (
    message.match(/column [a-zA-Z0-9_.]*\.([a-zA-Z0-9_]+) does not exist/)?.[1]
    || message.match(/'([a-zA-Z0-9_]+)' column/)?.[1]
    || details.match(/'([a-zA-Z0-9_]+)' column/)?.[1]
    || null
  );
};

/**
 * Runs a Supabase write, stripping any column PostgREST reports missing and
 * retrying, until it succeeds or a column can no longer be identified/removed.
 *
 * @param {(payload: object) => Promise<{data: any, error: any}>} runQuery
 *   Given a payload, performs the actual .insert()/.update()/.upsert() call.
 * @param {object} payload The full payload as if every column existed.
 * @param {string[]} [requiredColumns] Columns that must never be dropped -
 *   if the missing column is one of these, the error is real and is thrown.
 */
async function writeWithColumnRetry(runQuery, payload, requiredColumns = []) {
  let attemptPayload = { ...payload };
  const dropped = [];

  for (;;) {
    const { data, error } = await runQuery(attemptPayload);
    if (!error) return { data, dropped };

    if (!isMissingColumnError(error)) throw error;

    const missingColumn = getMissingColumnName(error);
    if (!missingColumn || requiredColumns.includes(missingColumn) || !(missingColumn in attemptPayload)) {
      throw error;
    }

    console.warn(`[SchemaRetry] column "${missingColumn}" missing from live schema, retrying without it - see DEPLOYMENT.md`);
    const { [missingColumn]: _omit, ...rest } = attemptPayload;
    attemptPayload = rest;
    dropped.push(missingColumn);
  }
}

module.exports = { isMissingColumnError, getMissingColumnName, writeWithColumnRetry };
