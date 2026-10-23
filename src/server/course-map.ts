import type * as http from "node:http";
import { escapeHtml } from "../markdown.ts";
import { shell } from "../pages.ts";
import { readCourseMap } from "../store/course-map.ts";
import type { CourseMap, CourseObjective } from "../store/course-map.ts";
import { sendHtml, sendNotFound } from "./http.ts";

const PURPOSES = {
  assessment: "Lesson check",
  "prior-retrieval": "Previously taught · retrieval",
  prequestion: "Coming up · prediction before teaching",
  prerequisite: "Prerequisite diagnosis",
};

function objectiveRow(objective: CourseObjective): string {
  return `<li class="cl-map-objective" id="${escapeHtml(objective.key)}">
<p>${escapeHtml(objective.statement)}</p>
<ul class="cl-map-connections" aria-label="Connected quizzes">${objective.quizzes
    .map(
      (quiz) =>
        `<li><span>${escapeHtml(quiz.id)}</span><span>${PURPOSES[quiz.purpose]}</span></li>`,
    )
    .join("")}</ul></li>`;
}

function courseMapPage(map: CourseMap): string {
  const root = `/c/${encodeURIComponent(map.classroom.name)}`;
  const nodes = new Map(
    [...map.upcoming, ...map.lessons.flatMap((lesson) => lesson.objectives)].map((node) => [
      node.key,
      node.statement,
    ]),
  );
  const nodeLink = (key: string) =>
    `<a href="#${escapeHtml(key)}">${escapeHtml(nodes.get(key)!)}</a>`;
  return shell({
    title: `Course map — ${map.classroom.title}`,
    bodyClass: "cl-shell cl-workspace-page",
    breadcrumb: `<a class="cl-crumb" href="/">Classrooms</a><span class="cl-crumb-sep" aria-hidden="true">/</span><a class="cl-crumb" href="${root}">${escapeHtml(map.classroom.title)}</a><span class="cl-crumb-sep" aria-hidden="true">/</span><span class="cl-crumb cl-crumb-current">Course map</span>`,
    body: `<div class="cl-course-map">
<div class="cl-hero"><h1>Course map</h1><p class="cl-lede">Where ${escapeHtml(map.classroom.title)} is heading, and what each lesson covers.</p></div>
<p><a href="${root}">← Back to classroom</a></p>
<nav aria-label="Course map sections" class="cl-map-nav"><a href="#course-upcoming">Coming up</a><a href="#course-objectives">Lesson objectives</a><a href="#course-connections">Connections</a></nav>
<section class="cl-map-mission cl-card-box" aria-labelledby="course-mission"><h2 id="course-mission">Your mission</h2>
<p class="cl-progress-note">The goals and context saved in your mission. These are aspirations, not completed objectives or a promised lesson sequence.</p>
${map.missionHtml ? `<div class="cl-map-mission-text">${map.missionHtml}</div><p><a href="/doc/${encodeURIComponent(map.classroom.name)}/MISSION.md">Read mission document</a></p>` : "<p>No mission has been recorded yet. Ask your teacher to help define where you want to go.</p>"}</section>
<section aria-labelledby="course-upcoming" class="cl-section"><h2 id="course-upcoming">Coming up</h2><p class="cl-progress-note">Objectives your teacher has explicitly planned in your mission. They do not imply scheduled lessons, mastery, or completed teaching.</p>
${map.upcoming.length ? `<ul class="cl-map-objectives">${map.upcoming.map((goal) => `<li class="cl-map-objective" id="${escapeHtml(goal.key)}"><p>${escapeHtml(goal.statement)}</p></li>`).join("")}</ul>` : "<p>No upcoming objectives have been recorded. Your mission still provides context for choosing what comes next.</p>"}</section>
<section aria-labelledby="course-objectives" class="cl-section"><h2 id="course-objectives">Lesson objectives</h2>
<p>Connections below come from the objectives and quiz purposes saved with each lesson. Quizzes under the same objective address that objective together.</p>
<p class="cl-progress-note">Teaching coverage does not show mastery. Opening a lesson, an immediate answer, or an assisted answer does not establish retention. See the classroom memory map for delayed, independent evidence.</p>
${map.lessons.length ? `<ol class="cl-map-lessons">${map.lessons.map((lesson) => `<li class="cl-map-lesson cl-card-box"><h3><a href="${escapeHtml(lesson.url)}">${escapeHtml(lesson.title)}</a></h3>${lesson.gated ? '<p class="cl-map-status">Coming up · Complete this lesson’s pretest to reveal its objectives and teaching.</p>' : lesson.missingPlan ? '<p class="cl-map-status">Objective mapping was not recorded for this older lesson.</p>' : `<ul class="cl-map-objectives">${lesson.objectives.map(objectiveRow).join("")}</ul>`}</li>`).join("")}</ol>` : '<p class="cl-map-status">No lessons yet. Your mission can guide the first lesson with your teacher.</p>'}
</section>
<section aria-labelledby="course-connections" class="cl-section"><h2 id="course-connections">Connections</h2><p class="cl-progress-note">These links were explicitly recorded in your mission. “Builds on” states a planned prerequisite; “related to” makes no prerequisite claim. Teaching and retention remain separate.</p>${map.connections.length ? `<ul class="cl-map-edges">${map.connections.map((edge) => `<li>${nodeLink(edge.from)} <strong>${edge.kind === "builds-on" ? "builds on" : "is related to"}</strong> ${nodeLink(edge.to)}</li>`).join("")}</ul>` : "<p>No objective connections are available to show yet. Connections are never guessed from matching words or lesson order.</p>"}</section></div>`,
  });
}

export function handleCourseMap(res: http.ServerResponse, classroom: string): void {
  try {
    const map = readCourseMap(classroom);
    if (!map) return sendNotFound(res, "Unknown classroom");
    sendHtml(res, courseMapPage(map));
  } catch (error) {
    const root = `/c/${encodeURIComponent(classroom)}`;
    sendHtml(
      res,
      shell({
        title: "Cannot load course map",
        bodyClass: "cl-shell cl-workspace-page",
        breadcrumb: `<a class="cl-crumb" href="${root}">Back to classroom</a>`,
        body: `<div class="cl-course-map"><h1>Cannot load course map</h1><p role="alert">${escapeHtml((error as Error).message)}</p><p>Correct the saved file, then retry loading.</p><a class="cl-button" href="${root}/course-map">Retry loading course map</a></div>`,
      }),
      500,
    );
  }
}
