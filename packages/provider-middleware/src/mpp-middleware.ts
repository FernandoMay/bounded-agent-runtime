import type { Request, Response, NextFunction } from "express";

export interface PaidEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  price: bigint;
  asset?: string;
  handler: (req: Request) => Promise<unknown>;
}

export function createPaidMiddleware(endpoints: PaidEndpoint[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const endpoint = endpoints.find(
      (e) =>
        e.path === req.path && e.method.toUpperCase() === req.method.toUpperCase(),
    );

    if (!endpoint) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const credential =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

    if (!credential) {
      return res.status(402).set({
        "Content-Type": "application/json",
        "X-Payment-Amount": String(endpoint.price),
        "X-Payment-Asset": endpoint.asset ?? "USDC",
        "X-Payment-Required": "Bearer <x402 voucher>",
      }).json({
        error: "Payment Required",
        price: endpoint.price.toString(),
        asset: endpoint.asset ?? "USDC",
        payable: true,
      });
    }

    try {
      const result = await endpoint.handler(req);
      return res
        .status(200)
        .set({
          "Content-Type": "application/json",
          "X-Payment-Amount": String(endpoint.price),
          "X-Payment-Receipt": `receipt-${endpoint.path}-${Date.now()}`,
        })
        .json(result);
    } catch (error) {
      return res.status(500).json({
        error: "Provider internal error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
