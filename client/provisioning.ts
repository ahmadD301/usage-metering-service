import type { HttpCall } from "./http.js";
import { provisionedAccountResponse } from "./schemas.js";

export const provisionAccount = (
  http: HttpCall,
  adminToken: string,
  name: string,
) =>
  http({
    method: "POST",
    path: "/accounts",
    body: { name },
    headers: { "x-admin-token": adminToken },
    schema: provisionedAccountResponse,
    retry: false,
  });

// account creation uses a different credential (the admin token)
// from everything else, so it lives apart from the API-key client.
// This file exists only because the demo has to bootstrap an account.
