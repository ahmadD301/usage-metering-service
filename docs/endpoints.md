# API Reference

## Overview

This document describes the available API endpoints, their purposes, authentication requirements, and notable HTTP response statuses.

## Authentication

All endpoints require the `X-API-Key` request header, except `POST /accounts`.

```http
X-API-Key: <your-api-key>
```

The `POST /accounts` endpoint is exempt from API-key authentication and uses its designated admin authentication mechanism.

## Endpoints

### 1. Health and Readiness

| Method | Endpoint  | Description                                                               | Response statuses                    |
| ------ | --------- | ------------------------------------------------------------------------- | ------------------------------------ |
| `GET`  | `/health` | Checks whether the service is running.                                    | `503` if the database is unavailable |
| `GET`  | `/ready`  | Checks whether the service and its database are ready to handle requests. | `503` if the database is unavailable |

### 2. Account Management

| Method | Endpoint        | Description                                                                 | Response statuses          |
| ------ | --------------- | --------------------------------------------------------------------------- | -------------------------- |
| `POST` | `/accounts`     | Creates an account using admin authentication and returns its API key once. | `201`, `401`, `404`, `422` |
| `GET`  | `/account`      | Retrieves the authenticated account and its assigned plan.                  | `401`                      |
| `PUT`  | `/account/plan` | Assigns a plan to the authenticated account.                                | `404`, `422`               |

**Notes:**

- The API key returned when an account is created is displayed only once. Store it securely.
- Account-specific operations require a valid `X-API-Key` header, except where otherwise specified.

### 3. User Management

| Method | Endpoint                             | Description                                                                       | Response statuses          |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------- | -------------------------- |
| `POST` | `/users`                             | Registers a user for the authenticated account.                                   | `201`, `409`, `404`, `422` |
| `GET`  | `/users`                             | Lists users belonging to the authenticated account using cursor-based pagination. | —                          |
| `GET`  | `/users/:externalId`                 | Retrieves a user and their assigned plan using the external user ID.              | `404`                      |
| `PUT`  | `/users/:externalId/plan`            | Changes the plan assigned to a specific user.                                     | `404`, `422`               |
| `GET`  | `/users/:externalId/effective-plans` | Retrieves the account-level plan and user-level plan together.                    | `404`                      |

**Notes:**

- `:externalId` is a path parameter representing the user's external identifier.
- User listing uses cursor-based pagination to support retrieving results in multiple pages.
- Effective plans expose both the account's plan and the user's plan for comparison or downstream evaluation.

### 4. Plan Management

| Method | Endpoint         | Description                                                   | Response statuses   |
| ------ | ---------------- | ------------------------------------------------------------- | ------------------- |
| `GET`  | `/plans`         | Lists predefined plans and custom plans owned by the account. | —                   |
| `GET`  | `/plans/:planId` | Retrieves a plan by its ID.                                   | `404`               |
| `POST` | `/plans`         | Creates a custom plan.                                        | `201`, `409`        |
| `PUT`  | `/plans/:planId` | Replaces the name and rules of a custom plan.                 | `403`, `404`, `409` |

**Notes:**

- Predefined plans are available for use but cannot be modified through the custom-plan update endpoint.
- Updating a predefined plan returns `403 Forbidden`.
- `:planId` is a path parameter identifying the target plan.
- Creating or updating plans may return `409 Conflict` when a naming or other uniqueness constraint is violated.

## HTTP Status Codes

| Status                     | Meaning                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `201 Created`              | The resource was created successfully.                                                                      |
| `401 Unauthorized`         | Authentication is missing or invalid.                                                                       |
| `403 Forbidden`            | The requested operation is not permitted, such as modifying a predefined plan.                              |
| `404 Not Found`            | The requested resource or referenced entity could not be found.                                             |
| `409 Conflict`             | The request conflicts with an existing resource or uniqueness constraint.                                   |
| `422 Unprocessable Entity` | The request contains invalid data or fails validation.                                                      |
| `503 Service Unavailable`  | The service cannot satisfy the request because a required dependency, such as the database, is unavailable. |

## Implementation Notes

- All authenticated endpoints use the `X-API-Key` header.
- The API key creation flow is intentionally separate from normal account authentication.
- Account and user plan assignments are managed through separate endpoints.
- Plan updates replace the custom plan's name and rules rather than partially updating individual fields.
- Endpoints marked with `—` do not have notable response statuses specified in this reference; this does not mean they cannot return errors.
