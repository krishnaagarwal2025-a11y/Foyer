import { createApplication } from "./app.js";
const application = await createApplication({
  cloud: process.env.FOYER_REDIS === "1",
});
application.http.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log(`Foyer server http://localhost:${process.env.PORT || 3001}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void application.close().finally(() => process.exit(0));
  });
