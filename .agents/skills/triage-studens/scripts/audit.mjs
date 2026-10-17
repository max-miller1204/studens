import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const usage = "Usage: node .agents/skills/triage-studens/scripts/audit.mjs [--out FILE]";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out")) {
  console.error(usage);
  process.exit(2);
}
const output = args.length ? resolve(args[1]) : undefined;
if (output && existsSync(output)) {
  console.error(`Refusing to overwrite existing evidence: ${output}`);
  process.exit(2);
}

function graphql(query, variables = {}) {
  const run = spawnSync("gh", ["api", "graphql", "--input", "-"], {
    input: JSON.stringify({ query, variables }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error) throw new Error(`Cannot run gh: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`GitHub query failed: ${run.stderr || run.stdout}`);
  const response = JSON.parse(run.stdout);
  if (response.errors?.length)
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(response.errors)}`);
  return response.data;
}

async function pages(query, variables, connection) {
  const nodes = [];
  const cursors = new Set();
  let after = null;
  do {
    const page = connection(graphql(query, { ...variables, after }));
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    after = page.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("GitHub returned a missing/repeated cursor.");
    cursors.add(after);
  } while (true);
}

const metadataQuery = `query {
  user(login: "max-miller1204") { projectV2(number: 8) {
    id title url readme shortDescription
    fields(first: 100) { pageInfo { hasNextPage } nodes {
      ... on ProjectV2Field { id databaseId name dataType }
      ... on ProjectV2SingleSelectField {
        id databaseId name dataType options { id name color description }
      }
      ... on ProjectV2IterationField { id databaseId name dataType }
    } }
    views(first: 100) { pageInfo { hasNextPage } nodes {
      id name number layout filter
      fields(first: 100) { pageInfo { hasNextPage } nodes {
        ... on ProjectV2FieldCommon { id name }
      } }
      groupByFields(first: 10) { nodes { ... on ProjectV2FieldCommon { id name } } }
      verticalGroupByFields(first: 10) { nodes { ... on ProjectV2FieldCommon { id name } } }
    } }
    workflows(first: 100) { pageInfo { hasNextPage } nodes { id name enabled } }
  } }
}`;

const inventoryQuery = `query($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2 {
    items(first: 100, after: $after, archivedStates: [ARCHIVED, NOT_ARCHIVED]) {
      pageInfo { hasNextPage endCursor } nodes {
        id isArchived
        content {
          __typename
          ... on Issue {
            id number title body url state stateReason repository { nameWithOwner }
            labels(first: 50) { pageInfo { hasNextPage } nodes { name } }
            assignees(first: 20) { pageInfo { hasNextPage } nodes { login } }
            parent { id number url }
            blockedBy(first: 20) { pageInfo { hasNextPage } nodes { id number url state } }
            closedByPullRequestsReferences(first: 20) {
              pageInfo { hasNextPage } nodes { id number url state isDraft merged }
            }
          }
          ... on PullRequest { id number title body url state isDraft repository { nameWithOwner } }
          ... on DraftIssue { id title body }
        }
        fieldValues(first: 100) { pageInfo { hasNextPage } nodes {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name optionId field { ... on ProjectV2SingleSelectField { id name } }
          }
          ... on ProjectV2ItemFieldNumberValue {
            number field { ... on ProjectV2FieldCommon { id name } }
          }
          ... on ProjectV2ItemFieldTextValue {
            text field { ... on ProjectV2FieldCommon { id name } }
          }
          ... on ProjectV2ItemFieldDateValue {
            date field { ... on ProjectV2FieldCommon { id name } }
          }
          ... on ProjectV2ItemFieldIterationValue {
            iterationId title startDate duration
            field { ... on ProjectV2IterationField { id name } }
          }
        } }
      }
    }
  } }
}`;

const matchesQuery = `query($id: ID!, $after: String, $filter: String!) {
  node(id: $id) { ... on ProjectV2 {
    items(first: 100, after: $after, query: $filter, archivedStates: [NOT_ARCHIVED]) {
      pageInfo { hasNextPage endCursor } nodes { id }
    }
  } }
}`;

const findings = [];
const report = { capturedAt: new Date().toISOString(), findings };
function complete(connection, label) {
  if (connection?.pageInfo?.hasNextPage)
    findings.push(`Incomplete ${label}: fetch the remaining page(s).`);
}
function value(item, name) {
  return item.fieldValues.nodes.find((entry) => entry.field?.name === name)?.name;
}
function expectedViews(item) {
  if (item.isArchived) return [];
  const expected = ["All items"];
  const content = item.content;
  if (!content || content.__typename !== "Issue") return expected;
  const epic = content.labels.nodes.some((label) => label.name === "epic");
  const status = value(item, "Status");
  const focus = value(item, "Focus");
  if (epic) expected.push("Roadmap");
  if (content.state === "OPEN") {
    if (status === "Triage") expected.push("Triage");
    if (!epic && !["Done", "Canceled", "Triage", "Backlog"].includes(status)) {
      if (focus === "Now" || focus === "Next") expected.push(focus);
    }
    if (!epic && status === "Backlog" && !focus) expected.push("Backlog");
  }
  return expected;
}

try {
  const project = graphql(metadataQuery).user?.projectV2;
  if (!project || project.url !== "https://github.com/users/max-miller1204/projects/8")
    throw new Error("Cannot identify the authorized studens-board project.");
  report.project = project;
  for (const key of ["fields", "views", "workflows"]) complete(project[key], key);
  const fields = new Map(project.fields.nodes.map((field) => [field.name, field]));
  for (const name of ["Focus", "Status", "Priority"])
    if (!fields.get(name)?.options) findings.push(`Missing single-select field: ${name}.`);
  if (
    fields
      .get("Focus")
      ?.options.map((option) => option.name)
      .sort()
      .join(",") !== "Next,Now"
  )
    findings.push("Focus must have exactly Now and Next options.");
  if (project.fields.nodes.some((field) => field.dataType === "ITERATION"))
    findings.push("Date-based iteration field conflicts with the undated planning contract.");

  const items = await pages(inventoryQuery, { id: project.id }, (data) => data.node.items);
  report.items = items;
  for (const item of items) {
    complete(item.fieldValues, `field values on ${item.id}`);
    const issue = item.content;
    if (!issue || issue.__typename !== "Issue") {
      findings.push(
        `Non-issue item needs review: ${item.id} (${issue?.__typename ?? "deleted content"}).`,
      );
      continue;
    }
    for (const key of ["labels", "assignees", "blockedBy", "closedByPullRequestsReferences"])
      complete(issue[key], `${key} on ${issue.url}`);
    if (issue.repository.nameWithOwner !== "max-miller1204/studens")
      findings.push(`Cross-repository item needs review: ${issue.url}.`);
    if (item.isArchived) continue;
    const status = value(item, "Status");
    if (!fields.get("Status")?.options.some((option) => option.name === status))
      findings.push(`Missing or unknown Status on ${issue.url}.`);
    if (issue.state === "CLOSED") {
      const wanted = issue.stateReason === "NOT_PLANNED" ? "Canceled" : "Done";
      if (status !== wanted)
        findings.push(`Closed issue ${issue.url}: expected ${wanted}, found ${status}.`);
    } else {
      if (["Done", "Canceled"].includes(status))
        findings.push(`Open issue has terminal Status ${status}: ${issue.url}.`);
      const epic = issue.labels.nodes.some((label) => label.name === "epic");
      if (
        !epic &&
        expectedViews(item).filter((name) => ["Now", "Next", "Backlog", "Triage"].includes(name))
          .length !== 1
      )
        findings.push(`Open issue lacks exactly one planning destination: ${issue.url}.`);
    }
  }

  const names = ["Now", "Next", "Backlog", "Roadmap", "Triage", "All items"];
  report.views = [];
  for (const name of names) {
    const views = project.views.nodes.filter((view) => view.name === name);
    if (views.length !== 1) findings.push(`Expected one ${name} view, found ${views.length}.`);
    for (const view of views) {
      complete(view.fields, `visible fields in ${name}`);
      const matches = await pages(
        matchesQuery,
        { id: project.id, filter: view.filter ?? "" },
        (data) => data.node.items,
      );
      const actual = new Set(matches.map((item) => item.id));
      const expected = new Set(
        items.filter((item) => expectedViews(item).includes(name)).map((item) => item.id),
      );
      const missing = [...expected].filter((id) => !actual.has(id));
      const unexpected = [...actual].filter((id) => !expected.has(id));
      report.views.push({ ...view, matches: [...actual], missing, unexpected });
      if (missing.length || unexpected.length)
        findings.push(
          `${name} filter differs from the contract: ${missing.length} missing, ${unexpected.length} unexpected.`,
        );
      if (view.layout !== (["Now", "Next"].includes(name) ? "BOARD_LAYOUT" : "TABLE_LAYOUT"))
        findings.push(`Unexpected layout for ${name}: ${view.layout}.`);
      if (view.groupByFields.nodes.length)
        findings.push(`Review horizontal grouping in ${name}; blank groups can hide items.`);
      if (["Now", "Next"].includes(name) && view.verticalGroupByFields.nodes[0]?.name !== "Status")
        findings.push(`Expected Status columns in ${name}.`);
    }
  }
  for (const view of project.views.nodes)
    if (!names.includes(view.name)) findings.push(`Additional view needs review: ${view.name}.`);
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
}

if (output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
console.log(
  JSON.stringify(
    {
      output,
      items: report.items?.length,
      views: report.views?.map((view) => ({ name: view.name, matches: view.matches.length })),
      findings,
      error: report.error,
      browserVerification:
        "Required: API matches cannot verify column visibility or saved hierarchy.",
    },
    null,
    2,
  ),
);
if (report.error) console.error(report.error);
if (findings.length) process.exitCode = 1;
