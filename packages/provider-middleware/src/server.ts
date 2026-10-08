import express, { type Request } from "express";
import { createPaidMiddleware, type PaidEndpoint } from "./mpp-middleware";

const app = express();
app.use(express.json());

const endpoints: PaidEndpoint[] = [
  {
    path: "/weather",
    method: "GET",
    price: 2n,
    asset: "USDC",
    handler: async () => ({
      temperatureC: 22,
      condition: "partly cloudy",
      unit: "celsius",
    }),
  },
  {
    path: "/market-data",
    method: "GET",
    price: 11n,
    asset: "USDC",
    handler: async (req: Request) => {
      const symbol = (req.query.symbol as string) || "SOL";
      return {
        symbol,
        priceUsd: 178.4,
        change24h: 2.1,
      };
    },
  },
  {
    path: "/inference",
    method: "POST",
    price: 43n,
    asset: "USDC",
    handler: async (req: Request) => {
      const body = req.body ?? {};
      return {
        result:
          "Synthesis complete. Paid inference endpoint returned a summarized answer.",
        model: "demo-llama-class",
      };
    },
  },
];

app.use(createPaidMiddleware(endpoints));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// @ts-ignore
const port = Number(process.env.PORT ?? 3001) || 3001;
app.listen(port, () => {
  console.log(`Provider middleware listening on http://localhost:${port}`);
});
