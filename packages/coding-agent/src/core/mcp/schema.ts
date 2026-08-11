import { type TSchema, Type } from "typebox";

export function jsonSchemaToTypeBox(schema: unknown): TSchema {
	if (schema === null || typeof schema !== "object") {
		return Type.Any();
	}
	const s = schema as Record<string, unknown>;
	const type = s.type;
	switch (type) {
		case "string":
			return Type.String(s.description ? { description: String(s.description) } : {});
		case "number":
			return Type.Number(s.description ? { description: String(s.description) } : {});
		case "integer":
			return Type.Integer(s.description ? { description: String(s.description) } : {});
		case "boolean":
			return Type.Boolean(s.description ? { description: String(s.description) } : {});
		case "array": {
			const items = s.items;
			return Type.Array(
				items !== undefined ? jsonSchemaToTypeBox(items) : Type.Any(),
				s.description ? { description: String(s.description) } : {},
			);
		}
		case "object": {
			const props = s.properties as Record<string, unknown> | undefined;
			const required = (s.required as string[] | undefined) ?? [];
			const requiredSet = new Set(required);
			const properties: Record<string, TSchema> = {};
			if (props) {
				for (const [key, value] of Object.entries(props)) {
					const propSchema = jsonSchemaToTypeBox(value);
					properties[key] = requiredSet.has(key) ? propSchema : Type.Optional(propSchema);
				}
			}
			return Type.Object(properties, s.description ? { description: String(s.description) } : {});
		}
		default:
			if (Array.isArray(s.enum) && s.enum.every((v) => typeof v === "string")) {
				return Type.Union(
					s.enum.map((v) => Type.Literal(String(v))),
					s.description ? { description: String(s.description) } : {},
				);
			}
			return Type.Any();
	}
}
