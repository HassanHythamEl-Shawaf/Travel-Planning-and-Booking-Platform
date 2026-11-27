import type { ReactNode } from "react";

export interface TableColumn<Row> {
  key: string;
  heading: string;
  render: (row: Row) => ReactNode;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  emptyMessage = "There’s nothing to show yet.",
}: {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="table-empty">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
