# Circle Hough prototype

The `/game` prototype records pointer coordinates while the user draws and scores the stroke when the pointer is released.

`scoreCircle()` uses a circle Hough-transform style accumulator to vote for likely center/radius pairs. The final 0–100 score combines radial consistency, angular coverage, and how closely the stroke returns to its starting point.
