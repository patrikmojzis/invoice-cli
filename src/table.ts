export type Column<T> = {
  header: string;
  value(row: T): string;
};

export function printTable<T>(rows: T[], columns: Array<Column<T>>): string {
  const matrix = [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => column.value(row))),
  ];
  const widths = columns.map((_, index) => Math.max(...matrix.map((row) => row[index].length)));

  return matrix
    .map((row, rowIndex) => {
      const line = row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
      if (rowIndex === 0) {
        const separator = widths.map((width) => "-".repeat(width)).join("  ");
        return `${line}\n${separator}`;
      }
      return line;
    })
    .join("\n");
}
