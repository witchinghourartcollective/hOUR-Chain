import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(await readFile(
  new URL("../../../specs/event-envelope.schema.json", import.meta.url), "utf8",
));
const ajv = new Ajv2020({ allErrors: true, ownProperties: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export function assertEnvelopeSchema(envelope) {
  if (!validate(envelope)) {
    throw new TypeError(`Invalid event envelope: ${ajv.errorsText(validate.errors)}`);
  }
}
