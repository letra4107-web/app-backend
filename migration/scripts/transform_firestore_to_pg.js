// Transform Firestore export JSON to CSV suitable for Postgres COPY.
// Usage: node transform_firestore_to_pg.js /path/to/collection-export.json output.csv --fields id,email,name,role

const fs = require('fs');
const { parse } = require('json2csv');

function usage() {
  console.log('Usage: node transform_firestore_to_pg.js <input.json> <output.csv> --fields field1,field2,...');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) return usage();
  const input = args[0];
  const output = args[1];
  const fieldsArg = args[2];
  const fields = (fieldsArg.replace('--fields=', '') || '').split(',').map((f) => f.trim()).filter(Boolean);

  const raw = fs.readFileSync(input, 'utf8');
  const items = JSON.parse(raw);

  // Firestore export may have documents as array or object; normalize
  const docs = Array.isArray(items) ? items : (items.documents || Object.values(items));

  const rows = docs.map((doc) => {
    // doc may contain fields in Firestore wire format; simplify by flattening known fields
    const obj = {};
    obj.id = doc.name ? doc.name.split('/').pop() : doc.id || doc._id || '';
    fields.forEach((f) => {
      let v = doc[f];
      if (v === undefined && doc.fields && doc.fields[f]) {
        // Firestore wire format
        const valObj = doc.fields[f];
        // assume simple string or integer
        v = valObj.stringValue || valObj.integerValue || valObj.doubleValue || null;
      }
      obj[f] = v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    return obj;
  });

  const csv = parse(rows, { fields: ['id', ...fields] });
  fs.writeFileSync(output, csv, 'utf8');
  console.log(`Wrote ${rows.length} rows to ${output}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
