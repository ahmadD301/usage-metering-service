# Usage Metering Service: Project Brief

## Overview

Build a backend service that other applications call to track usage and decide whether their users can perform an action. The service supports plans for both the calling application and its individual users.

Imagine a company running a document processing application. The company has a shared monthly allowance, and each user has an individual allowance. Before processing a document, the application's backend asks your service to consume units for a particular user. Your service checks both allowances, records the decision, and counts the usage if the request is accepted.

The application can choose predefined plans or create and configure its own plans through your API. Changes to plan settings should take effect without redeploying the service.

- **Timeline:** 1 week.
- **Stack:** TypeScript and SQL, with PostgreSQL. One service and one database are enough.

## Product Assumptions

Some product behavior and business rules are intentionally left unspecified. For cases the brief does not define, choose sensible behavior, document your assumption and reasoning in the README, and continue implementing without waiting for clarification. Keep these choices consistent with the stated requirements and apply them consistently throughout the service.

## Accounts, Users, and Plans

| Concept | Meaning |
|---|---|
| **Account** | An application or company calling your service. Its plan defines limits shared by all its users. |
| **User** | A user of that application, registered under an account. Their plan defines their individual limits. |
| **Plan** | A named set of configurable rules that can be assigned to an account or a user. |
| **Units** | The amount consumed by an action, such as document processing credits. Use one resource throughout the project. |

An account has an account plan, and each user has a user plan. The two plans apply together. Giving a user a larger allowance does not increase the account's shared allowance.

The calling application must supply an API key in a request header for operations on an account and its users. The key identifies the calling account and grants access only to that account's data. Reject missing or invalid keys, and validate that any supplied user belongs to the identified account.

## Core Features

### Manage accounts and users
Create accounts and issue an API key for each one. Register users under accounts, and assign or change their plans. Keep each account's users and usage separate.

### Provide predefined plans
Include ready-to-use plans for both accounts and users when the service starts. For example, offer Starter and Pro account plans, and Basic and Premium user plans. Choose sensible example limits and document them.

### Support custom plans
Let an account create, view, and update its own plans, then assign them to the account or its users. Several users may share the same plan definition while keeping separate usage totals. Predefined plans can remain read-only.

### Consume units
Identify the account through its API key and accept a user identifier, a positive whole number of units, and a request identifier. Accept the full amount only if all applicable account and user rules allow it. A rejection consumes nothing.

### Explain decisions
Return whether the request was accepted. For a rejection, identify a rule that prevented it and whether that rule belongs to the account or user. Let callers inspect the plans and limits currently applied to each.

### Show usage and history
Return consumed and remaining units for both the account and its users. Allow callers to view previous months' usage and request outcomes. Simple pagination is enough for history.

### Preserve data
Store accounts, users, plans, assignments, usage, and request history in the database so they survive a restart.

Choose and document your own API endpoints, request and response formats, and database design.

## How Plans Affect Consumption

Support these two rule types for both account and user plans:

- **Monthly allowance:** The total units available during a UTC calendar month.
- **Maximum units per request:** The largest amount that can be consumed in a single request.

Every request must satisfy both plans. For example, an account might allow 10,000 units per month and 100 per request, while a user's plan allows 1,000 per month and 20 per request.

- A request for **25 units** is rejected by the user's per-request limit, even if both monthly allowances have enough units remaining.
- A request for **10 units** is accepted when both have enough remaining. It adds 10 to the user's usage and 10 to the account's shared usage, representing the same action.
- If the account has only **five units remaining**, that 10-unit request is rejected even if the user has plenty left.

The account's usage is the sum of accepted usage across its users. Users sharing a plan do not share their individual allowance. New usage belongs to the UTC month when it is processed. Each new month starts with zero usage at both levels, while previous months remain available for queries.

## Changing and Extending Rules

Plan changes apply to new requests after the update succeeds. Updating an account's custom plan affects its assigned account or users. Switching plans preserves units already consumed; it does not grant a fresh monthly allowance. If a monthly allowance is reduced below existing usage, show zero remaining allowance and reject further consumption at that level until allowance becomes available again. Changes must preserve past request history.

You are free to decide how rules are represented, configured, and evaluated. Explain how any additional rules interact with account and user plans, and demonstrate their behavior.

## Example Application or Client

Include a small working application or client that calls the service using an account's API key on behalf of its users. A simple web page or command-line application is enough; the document processing or other business action can be simulated.

Demonstrate users under the same account with different plans:

1. Show an accepted action.
2. Show a rejection caused by a user limit.
3. Show a rejection caused by the shared account limit.
4. Configure or switch a plan and show how it changes what a user can do without changing the client code.

Display the decision and remaining allowances, and include instructions for running the example.

Provide a Docker Compose file that starts the full stack with `docker compose up --build`, including the usage metering service, PostgreSQL, the example application or client, and any additional dependencies. Handle database initialization and predefined plan setup as part of startup. Document any required configuration and how to access or interact with the example client.

## Performance

Pay attention to performance while ensuring usage totals and decisions remain correct as rules change and requests arrive concurrently. Test your service under load and include evidence of the results, along with a brief explanation of how you tested it and what you learned. You choose the tools and implementation approach.

## What We're Looking For

| Area | What we're looking at |
|---|---|
| **Correctness** | Accurate account and user totals, correct application of both plans, and predictable behavior when plans change. |
| **Reliability** | Safe retries, correct handling of competing requests, preserved data, and useful errors. |
| **Performance** | Evidence of performance testing, an understanding of bottlenecks, and improvements that preserve correctness. |
| **Design and Code Quality** | A thoughtful schema, readable TypeScript, and clear organization of rules, accounting, and API handling. |
| **Local Setup** | A working Docker Compose setup that runs the complete stack, including the example client. |
| **Documentation and Usability** | Straightforward setup, clear API examples, reproducible tests, and a client that demonstrates the effect on users. |
| **Understanding and Judgment** | Ownership of the implementation, thoughtful product decisions with documented assumptions, explained tradeoffs, and sensible choices about scope and custom rules. |

A reliable, well-explained core is more valuable than unfinished extras. Billing, payments, refunds, multiple resource types, end-user login, role-based permission management, and distributed infrastructure are outside the required scope.

## Deliverables

1. A GitHub repository containing the service, predefined plans, and example application or client, with straightforward local setup instructions.
2. A Docker Compose file and the Dockerfiles or images needed to run the complete stack, including the example client.
3. A README explaining the API, account and user model, how to obtain and use API keys, supported rules, plan changes, retry behavior, product assumptions, main design decisions, and known limitations.
4. Automated tests covering the important behaviors above, including API key validation and account isolation.
5. Performance test results, along with committed tests, scripts, custom tools, and configuration needed to reproduce them. Include the commands and required dependencies.

AI tools are welcome. Be ready to trace a request through your code, explain your decisions, and debug or make a small change during the discussion.
