# CPU-LLM v2: a design, planning and insights lab for people who run LLMs on CPUs

*Draft announcement. Short enough for a LinkedIn post or a forum thread; the
long version with every source is the live page https://cpullm.gccandfde.com/v2/features/.*

---

We read what engineers are actually stuck on, in vendor tuning guides, the
llama.cpp multi-NUMA thread, Strix Halo bandwidth debates, serving papers and
cost-per-token analyses. Then we built v2 of CPU-LLM to answer those questions
with numbers you can check against your own machine.

**If you have asked any of these, v2 has a page for it:**

- *NPS1 or NPS4? Distribute or bind? Why was using both sockets slower?*
  → Planner: every placement ranked for your model size, with the ones that
  cannot work flagged and the thread count per replica.
- *Why did more threads make decode slower?* → the thread curve with the
  bandwidth-saturation point and the cross-node penalty, and one click to
  measure it on your machine and overlay the real numbers.
- *Which bandwidth is real: the spec sheet or what decode gets?* → Insights
  turns every measured run into achieved GB/s and the fraction of the
  machine's bandwidth it is, and applies that to all projections.
- *Will int4 actually speed this up here?* → bytes moved vs native support vs
  dequantisation cost, per precision, on your CPU.
- *How many users does one box take? Should I split prefill and decode?*
  → concurrency sweep, KV memory, the compute knee, and a disaggregation hint.
- *What does a token cost at my utilisation, and when does owning beat the
  API?* → cost per million tokens and the break-even volume.
- *What would a CPU with 8 channels and bigger L3 do?* → the Designer: die,
  cache and NUMA-level sliders, a roofline with DRAM, L3, vector and matrix
  ceilings, and a design-space grid.

Everything projected is first-order and says so; everything measured comes
from the agent you install with one line on any Windows, Linux, macOS or WSL
machine. Measured runs calibrate the projections, and an AI advisor (Claude,
bring your own key) reasons over both.

Try it: https://cpullm.gccandfde.com — v1 stays available for people who only
want the tuner.

Companion: MachineForge (https://machineforge.gccandfde.com) turns one Linux
host into pinned-core, memory-limited machines, each able to start with the
CPU-LLM agent inside, so a benchmark matrix across sizes fills itself.
