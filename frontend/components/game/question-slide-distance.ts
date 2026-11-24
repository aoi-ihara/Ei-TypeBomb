/** The question's visible bounds, not the progress bar or slide viewport. */
export function getQuestionSlideDistance(element: HTMLElement): number {
    const available = element.offsetWidth;

    // Preserve the full-screen mobile transition, including its gutters.
    if (!window.matchMedia("(min-width: 40rem)").matches) return available;

    const content = element.querySelector<HTMLElement>("[data-question-slide-content]");
    if (!content) return available;
    let width = 0;
    for (const part of content.querySelectorAll<HTMLElement>("[data-question-slide-width]")) {
        width = Math.max(width, part.offsetWidth);
    }
    if (!width) return available;
    const { paddingLeft, paddingRight } = getComputedStyle(content);
    const gutter = (parseFloat(paddingLeft) || 0) + (parseFloat(paddingRight) || 0);
    return Math.min(available, width + gutter);
}
