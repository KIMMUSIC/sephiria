const ts = require("/workspace/sephiria/node_modules/typescript");
const configPath = "/workspace/sephiria/tsconfig.json";
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) { console.error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")); process.exit(1); }
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, "/workspace/sephiria");
const options = Object.assign({}, parsed.options, { incremental: false, composite: false, tsBuildInfoFile: undefined });
const program = ts.createProgram({ rootNames: parsed.fileNames, options });
const diagnostics = ts.getPreEmitDiagnostics(program).concat(parsed.errors);
for (const d of diagnostics) {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  if (d.file && d.start != null) {
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    console.log(d.file.fileName + ":" + (pos.line+1) + ":" + (pos.character+1) + " - " + msg);
  } else { console.log(msg); }
}
console.log("diag_count=" + diagnostics.length);
process.exit(diagnostics.length ? 1 : 0);
