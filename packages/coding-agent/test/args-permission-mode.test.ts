import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";

describe("parseArgs --permission-mode", () => {
	it("parses valid permission modes", () => {
		expect(parseArgs(["--permission-mode", "ask"]).permissionMode).toBe("ask");
		expect(parseArgs(["--permission-mode", "allow"]).permissionMode).toBe("allow");
		expect(parseArgs(["--permission-mode", "read-only"]).permissionMode).toBe("read-only");
		expect(parseArgs(["--permission-mode", "auto"]).permissionMode).toBe("auto");
	});

	it("records a warning for invalid permission modes", () => {
		const result = parseArgs(["--permission-mode", "block-everything"]);
		expect(result.permissionMode).toBeUndefined();
		expect(result.diagnostics).toContainEqual({
			type: "warning",
			message: 'Invalid permission mode "block-everything". Valid values: ask, allow, read-only, auto',
		});
	});
});
