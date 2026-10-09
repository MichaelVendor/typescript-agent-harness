export type Order = { id: string; status: string; carrier?: string };

const ORDERS: Order[] = [
  { id: "A123", status: "shipped", carrier: "SF Express" },
  { id: "B456", status: "processing" },
];

export function findOrder(id: string): Order | undefined {
  return ORDERS.find((o) => o.id === id.toUpperCase());
}
