import * as fs from "fs";
import * as path from "path";
import { ReportData, formatMarkdown, formatPlainText } from "./formatter.js";

export type ExportFormat = "md" | "txt";

export function generateReport(data: ReportData, format: ExportFormat): string {
  if (format === "txt") {
    return formatPlainText(data);
  }
  return formatMarkdown(data);
}

export function exportReport(data: ReportData, format: ExportFormat, exportPath?: string): string {
  const content = generateReport(data, format);
  const ext = format === "txt" ? ".txt" : ".md";
  const filePath = exportPath ?? `./k8s-rca-report${ext}`;

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}
