import { createApplication } from "../server/app.js";

// Vercel's native WebSocket runtime accepts an exported HTTP server.
// Shared persistence is required: ephemeral instance memory is never authority.
const application = await createApplication({ cloud: true });
export default application.http;
