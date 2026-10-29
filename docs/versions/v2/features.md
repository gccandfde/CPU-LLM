# CPU-LLM v2: stable

**Stable version.** Everything in [v1](/v1/features/) (tuning runs, fleet,
compare, recipes, admin, one-line installer) plus a design, planning and
insights lab for the people who build or choose hardware for LLMs: CPU and GPU
companies, performance engineers, LLM-accelerator and VLSI engineers,
simulation engineers, and anyone sizing a deployment.

Data and machines are shared with v1: a run started in either shows up in both.

## The problems v2 answers

Before this version was finalised we read what engineers are actually
struggling with on vendor blogs, GitHub discussions and community threads.
Each row below is a problem people report, and where v2 answers it.

| What people report | Where v2 answers it |
|---|---|
| **NUMA confusion.** NPS1 vs NPS4, `--numa distribute` vs `numactl` binding, "using both sockets was slower", no way to keep a model local when it exceeds one node's RAM ([llama.cpp #19102](https://github.com/ggml-org/llama.cpp/discussions/19102), [AMD EPYC tuning guide](https://docs.amd.com/api/khub/documents/goX~9ubv8i5r60A_Qrp3Rw/content), [Lenovo](https://lenovopress.lenovo.com/lp2283-balanced-memory-configurations-with-5th-generation-amd-epyc-processors)) | **Planner → NUMA placement**: every placement (replica per node, interleaved, single node) with projected speed, memory per replica, which ones are impossible for this model size, and the recommended thread count per replica. |
| **"More threads got slower."** Thread counts beyond a node's cores collapse throughput through barrier cost and remote traffic; SMT siblings add nothing ([Neoverse N2 analysis](https://semiengineering.com/scaling-llama-cpp-on-neoverse-n2-solving-cross-numa-performance-issues/), [llama.cpp tuning guides](https://www.bigiron.cc/guides/llama-cpp-tuning-for-cpu-only-homelab-inference)) | **Planner → Thread count**: the curve of tok/s against threads with the bandwidth-saturation point, the node boundary and the cross-node penalty, plus the exact thread counts to put into a tuning run to measure it. |
| **Which bandwidth is real?** Spec-sheet figures (Strix Halo 256 GB/s) vs measured decode (158–215 GB/s); MRDIMM/channel population changing everything ([Framework community](https://community.frame.work/t/ryzen-ai-max-not-so-much/77999), [Xeon 6 MRDIMM scaling](https://www.techedubyte.com/intel-xeon-6-granite-rapids-mrdimm-scaling-6-to-12-modules-t/)) | **Insights → Calibration**: every measured configuration converted into the bandwidth it really achieved and the fraction of the machine's measured bandwidth that is; one click makes the Designer and Planner assume that fraction. The agent's bandwidth benchmark is now a multi-threaded streaming read, not a single copy. **Designer → Sweep** memory channels per node. |
| **Quantisation that does not speed anything up.** Dequantisation overhead when the format is not native; int4 accuracy drops ([AMD ROCm blog](https://rocm.blogs.amd.com/artificial-intelligence/gptq/README.html), [Intel PyTorch on Xeon](https://www.intel.com/content/www/us/en/developer/articles/technical/boost-language-models-with-pytorch-on-xeon.html)) | **Planner → Will quantisation pay off here?** Bytes moved, native support (BF16 / VNNI / AMX), projected bound and speedup per precision with the reason. The v1 tuner remains the measured answer, with perplexity and task accuracy per configuration. |
| **Prefill vs decode, KV cache growth, how many users fit.** Disaggregated serving, KV memory exhausting a box before compute saturates ([NVIDIA on Kubernetes](https://developer.nvidia.com/blog/deploying-disaggregated-llm-inference-workloads-on-kubernetes/), [NVIDIA EPD](https://developer.nvidia.com/blog/when-to-use-encode-prefill-decode-disaggregation-to-accelerate-multimodal-model-serving/), [arXiv 2601.19910](https://arxiv.org/pdf/2601.19910), [Lenovo Xeon 6 at 128 users](https://lenovopress.lenovo.com/lp2406-implementing-ai-agents-without-gpus-high-performance-inference-on-intel-xeon-6)) | **Planner → Serving**: concurrency sweep with aggregate and per-user tok/s, TTFT, KV memory, users that fit, the compute knee, and whether prefill or decode dominates (so whether disaggregating would pay). |
| **Cost per token and utilisation.** Idle capacity multiplies cost; self-hosting only breaks even at volume ([Red Hat tokenomics](https://developers.redhat.com/articles/2026/08/19/tokenomics-self-hosted-llms), [Introl](https://introl.com/blog/cost-per-token-llm-inference-optimization), [break-even calculator](https://www.kunalganglani.com/blog/local-llm-cost-breakeven)) | **Planner → Cost per million tokens**: machine price, electricity, utilisation, depreciation and the API price to beat → $/M tokens and the daily volume at which owning wins. **Designer → Scale-out planner** for the fleet. |
| **The 2-D roofline hides the vector/matrix split** and memory-level interactions ([DECA, MICRO 2025](https://arxiv.org/html/2505.19349)) | **Designer → Roofline with every ceiling**: DRAM, L3, vector FMA and the matrix unit (AMX) drawn together, with decode steps at batch 1…256 placed on them. |
| **Pre-silicon tools don't let you change bandwidth, memory or compute** ([MLDSE](https://arxiv.org/pdf/2503.21297), [UCLA analytical DSE](https://nanocad.ee.ucla.edu/wp-content/papercite-data/pdf/c129.pdf)) | **Designer**: every parameter is a slider; **design-space grid** (channels × cores per die) with the best fitting cell; sweeps; compare; saved designs. |
| **Is my speedup real?** Run-to-run noise, thermal state, frequency scaling | **Insights → Noise and significance**: each machine's noise band from the re-measured baseline, how many configurations beat it. |
| **"What would machine X do?"** before buying it | **Insights → Predict an unmeasured machine**: calibrated bandwidth model with a p25–p75 band, cross-checked by the nearest measured runs (3-NN over size, bandwidth, threads). |
| **Reasoning over all of it** | **Insights → Advisor**: Claude answers with the measurements and the design in context, separating measured from projected and saying how to verify with a run. Enabled by an admin with an Anthropic API key (never leaves the server). |

## Designer

Design a CPU and see what an LLM would do on it, before the silicon or the
purchase exists.

- **Start from** a reference part (Ryzen 9 8940HX, Ryzen 9 9950X, EPYC 9654,
  Xeon Platinum 8592+, an HBM-CPU concept), a **connected machine's measured
  profile**, or a saved design.
- **Die level:** dies, cores per die, SMT, clock, FMA units, vector width,
  BF16/VNNI/AMX. **Cache level:** L1d, L2 per core, L3 per die, L3 bandwidth.
  **NUMA level:** nodes, channels per node and channel type (DDR4/DDR5/LPDDR5X/HBM3),
  capacity per node, node fabric bandwidth and latency. Power envelope.
- **Pin the workload:** replica per node, interleaved or single node; model (or a
  custom one: parameters, active parameters, layers, KV heads, head dim),
  precision, batch, context, prompt; bandwidth and compute efficiency.
- **Projected:** tok/s per sequence and aggregate, TTFT, tok/J, memory and fit,
  memory vs compute time shares, **where the bytes live** (layer in L3? KV in
  L2/L3? L3 turnover per step).
- **Roofline with every ceiling**, **design-space grid**, **sweep** any parameter,
  **compare** designs, **scale-out planner** (machines, kW, memory, fabric for a
  tensor-parallel split), **Ask the advisor** about the current design.

## Planner

NUMA placement, thread count, serving concurrency and KV memory, quantisation
pay-off, cost per million tokens: for a reference part, a connected machine or
a saved design. Each section says which tuning run would measure its answer.

## Insights

Calibration of projections against measured runs (with one click to apply the
calibrated efficiency everywhere), noise and significance per run, the
predictor for unmeasured machines, the machine × model benchmark matrix with
links to measure the empty cells, and the advisor.

## Also in v2

- Agent: memory bandwidth is measured with a multi-threaded streaming read
  (what decode does to the weights) and a copy; the better figure is reported,
  both are kept in the profile.
- Admin → **AI advisor** card: API key, on/off, model, effort, answer length.
- Versioned site: `/v1` previous stable (fixes only), `/v2` stable, `/v3` preview.

## Honest limits

The projections are first-order and analytical: bandwidth = nodes × channels ×
channel speed scaled by pinning; compute = cores × clock × FMA units × lanes,
halved for non-native precisions; decode step = max(bytes ÷ bandwidth, FLOPs ÷
compute). They give the shape and the order of magnitude. Kernel quality,
frequency scaling, OS scheduling and thermal state are not modelled: measured
runs are the ground truth, and the Insights tab exists to keep the model honest
against them.
