// Learn tab: concept map for inference & serving engineering.
// Organized around a 3-layer stack: L1 (endpoints/backend), L2 (runtime: batching,
// scheduling, KV cache, serving metrics, distributed inference), L3 (kernels/GPU).
// Each entry is a standalone paragraph: what it is, why it matters, and how it
// connects to the layer above and below.

const CONCEPTS = [
    // ---------------- L1: endpoints & backend serving (bridge into L2) ----------------
    {
        id: 'l1-endpoints-backend',
        layer: 'L1',
        title: 'Endpoints & Backend Serving',
        text: "This is the layer you're already strong at: request handling, API design, auth, backend infra for AI agents. In an inference stack it's the outermost shell — the thing that receives a request and eventually has to return tokens to a caller. The reason it still matters once you move up the stack is that every L2 decision (how requests get batched, scheduled, routed) is downstream of how requests arrive and what SLA the backend promised the caller. A clean L1 — predictable request shapes, good observability, sane timeouts and retries — makes the runtime layer's job tractable. A messy one (bursty traffic with no backpressure, no request metadata about priority or max tokens) makes good scheduling nearly impossible no matter how clever the L2 engine is. Think of L1 as the interface contract that L2 has to serve under."
    },
    {
        id: 'l1-replication-partitioning',
        layer: 'L1',
        title: 'Replication, Partitioning & Consistency',
        text: "From distributed systems (Kleppmann, *Designing Data-Intensive Applications*, the chapters on replication and partitioning): replication copies the same data/model across multiple nodes for availability and read scaling; partitioning splits data/work across nodes so no single machine has to hold everything; consistency models define what guarantees you get when reads and writes happen concurrently across those copies. In inference serving this shows up directly one layer up: a fleet of GPU workers behind a router is replication (same model, many copies) handling load, and tensor parallelism is a form of partitioning (splitting one model's weights/compute across GPUs because a single GPU can't hold it). The consistency questions get easier in inference than in databases — you're mostly serving stateless requests against a frozen model — but the same mental model (copies for scale, splits for size, and reasoning about what's shared state vs. local state) is exactly what you need to reason about KV cache placement and routing in L2."
    },
    {
        id: 'l1-batch-stream-processing',
        layer: 'L1',
        title: 'Batch vs. Stream Processing',
        text: "Also from Kleppmann: batch processing takes a bounded dataset and processes it all at once (think nightly ETL jobs), while stream processing handles an unbounded sequence of events as they arrive, continuously. The distinction maps almost one-to-one onto the two batching strategies you'll see in L2: static/dynamic batching is the batch-processing mindset applied to inference (collect a group of requests, run them through the model together, return all results), while continuous batching is the stream-processing mindset applied to inference (treat requests as an ongoing stream, admit and evict individual sequences from a running batch token-by-token instead of waiting for a batch boundary). Understanding why streaming systems beat batch systems for latency-sensitive, open-ended workloads in data engineering is the same intuition that explains why continuous batching beat static batching for LLM serving — it's one abstraction layer down, same underlying tradeoff between throughput-via-batching and latency-via-immediacy."
    },

    // ---------------- L2: the runtime layer ----------------
    {
        id: 'l2-static-dynamic-batching',
        layer: 'L2',
        title: 'Static & Dynamic Batching',
        text: "Static batching groups a fixed set of requests together, runs them through the model as one batch, and only returns results once every request in that batch is done — so one slow, long-output request holds up every short one stuck behind it. Dynamic batching relaxes this slightly: the server waits a short window to accumulate incoming requests before forming a batch, trading a little latency for better GPU utilization, but it still treats the batch as a fixed unit once formed. Both approaches matter because GPUs are built for parallel throughput, not single-request latency — an idle GPU running one request at a time wastes most of its compute. The limitation both share, and the reason continuous batching exists, is that autoregressive generation means requests finish at wildly different times (short vs. long outputs), so a fixed-batch abstraction is a poor fit for the actual workload shape. This sits directly below the scheduling policies that decide how requests get admitted into these batches, and above L3's reality that batching exists purely to keep GPU cores fed."
    },
    {
        id: 'l2-continuous-batching',
        layer: 'L2',
        title: 'Continuous (Iteration-Level) Batching',
        text: "Continuous batching, introduced by the Orca paper, reframes batching at the granularity of a single decoding step rather than a whole request. Instead of waiting for every sequence in a batch to finish before forming the next batch, the scheduler re-forms the batch after every token: finished sequences are evicted immediately and new requests are admitted into the freed GPU memory slots, all while other sequences in the batch keep generating. This is the single biggest reason modern serving systems (vLLM, TensorRT-LLM, etc.) get dramatically higher throughput than naive static batching — GPU utilization stays high because there's no stalling for the slowest sequence in a batch. It depends on the KV cache being manageable per-sequence (which is exactly what PagedAttention solves below it), and it's the mechanism that the scheduling policies above it actually operate on — when people say 'the scheduler decided to preempt a request,' continuous batching is the substrate that makes that decision actionable mid-generation rather than only at batch boundaries."
    },
    {
        id: 'l2-scheduling-policies',
        layer: 'L2',
        title: 'Scheduling Policies',
        text: "Once a server can admit and evict requests at every decoding step (continuous batching), it needs a policy for *which* requests get in, in what order, and which get preempted when memory runs out. Common policies include first-come-first-served (simple, but a long request can hog memory behind which everything queues), priority-based scheduling (some requests — e.g. interactive chat — jump the queue ahead of batch/offline jobs), and preemption with either swapping (evict a sequence's KV cache to CPU memory and reload it later) or recomputation (drop it and redo the prefill when it's re-admitted). The policy choice is really a latency-vs-throughput-vs-fairness tradeoff, and it's the direct analog of OS process scheduling or a distributed systems request queue — same problem, different resource (GPU memory and compute instead of CPU time). It sits on top of KV cache management (what actually gets evicted or swapped) and underneath the serving-level metrics — TTFT and throughput — that tell you whether your policy choice was any good."
    },
    {
        id: 'l2-kv-cache',
        layer: 'L2',
        title: 'KV Cache',
        text: "Transformers generate tokens autoregressively, and the attention mechanism at each step needs the key/value projections of every previous token in the sequence. Recomputing those projections from scratch at every new token would be wasteful, so serving systems cache them — the KV cache — and only compute the new token's key/value each step, reusing everything before it. The catch is that this cache grows linearly with sequence length and lives in GPU memory alongside the model weights, so for long contexts or many concurrent sequences it becomes the dominant memory consumer and the real bottleneck on how many requests you can batch together. This is precisely the resource that scheduling policies are fighting over, and it's why KV cache memory management became its own subfield — which is exactly the problem PagedAttention was built to solve one concept below. Going down another layer, the KV cache is just GPU memory, so its access pattern and layout have real consequences for the memory-coalescing and tiling concerns at L3."
    },
    {
        id: 'l2-pagedattention',
        layer: 'L2',
        title: 'PagedAttention',
        text: "Before PagedAttention (the vLLM paper), KV caches were stored as large contiguous memory blocks sized for the maximum possible sequence length, which wasted enormous amounts of GPU memory to internal fragmentation — most requests don't use their full context window, but the memory was reserved as if they would. PagedAttention borrows the idea of virtual memory paging from operating systems: it splits each sequence's KV cache into small fixed-size blocks that don't need to be contiguous in physical GPU memory, and maintains a block table (like a page table) mapping logical positions to physical blocks. This nearly eliminates fragmentation and, as a bonus, makes memory sharing cheap — multiple sequences that share a prefix (e.g. the same system prompt) can literally share the same physical blocks. The direct payoff one layer up is that schedulers can pack far more concurrent sequences into the same GPU memory, which is what let continuous batching scale to the throughput numbers that made it the default. It's a serving-system idea, but the reason it works at all is a kernel-level fact at L3: attention can be computed correctly even when the K/V tensors it reads are scattered across non-contiguous memory blocks, as long as the kernel is written to gather them."
    },
    {
        id: 'l2-ttft',
        layer: 'L2',
        title: 'Time to First Token (TTFT)',
        text: "TTFT measures how long a request waits from submission until the very first output token is streamed back. It's dominated by two things: queueing/scheduling delay (how long the request sat waiting for GPU capacity) and the prefill pass (the single forward pass over the entire input prompt, which is compute-bound and scales with prompt length). TTFT is the metric users feel most directly in a chat-like interface — it's the 'did this thing respond' moment — which is why it's the headline number product teams optimize for separately from overall throughput. It's also the metric most directly impacted by scheduling policy and by prefill/decode disaggregation below it: if prefill and decode share the same GPU, a long decode phase for another request can delay your prefill and blow up your TTFT, which is exactly the interference problem disaggregation is designed to remove. At the hardware level (L3), prefill is typically compute-bound (good GPU utilization, roofline-model-friendly), so TTFT improvements from kernel work tend to come from raw FLOP efficiency rather than memory-bandwidth tricks."
    },
    {
        id: 'l2-inter-token-latency',
        layer: 'L2',
        title: 'Inter-Token Latency / TPOT',
        text: "Inter-token latency (also called time-per-output-token, TPOT) measures the delay between consecutive generated tokens during decode — effectively, how 'smooth' the streaming output feels after the first token has already arrived. Unlike prefill, decode processes one new token per sequence per step, which makes it memory-bandwidth-bound rather than compute-bound: the GPU spends most of its time moving the KV cache and weights through memory rather than doing dense matrix math, so bigger batches (more sequences decoding together) are the main lever for improving GPU utilization during decode. This is why continuous batching and KV cache efficiency matter so much for inter-token latency specifically — every sequence competing for decode-step GPU time adds contention, and a memory-bandwidth-bound workload is unforgiving of layout inefficiency. It's also the metric most exposed to the memory-coalescing and occupancy concerns at L3, since decode kernels live or die on how efficiently they move small amounts of data per step. Together, TTFT and inter-token latency are the two halves of 'does this feel fast,' and most serving-system tradeoffs are really about shifting cost between the two."
    },
    {
        id: 'l2-throughput',
        layer: 'L2',
        title: 'Throughput',
        text: "Throughput in serving is usually measured in tokens/second or requests/second across the whole system, and it's fundamentally in tension with per-request latency (TTFT and inter-token latency) — packing more concurrent work onto a GPU improves aggregate throughput but adds queueing and contention that hurts any individual request's latency. The whole point of dynamic/continuous batching, scheduling policy, and PagedAttention is to push this tradeoff curve outward: get more throughput for the same latency budget, or the same throughput at lower latency. It's the metric that determines unit economics (cost per token served) and is where distributed-inference techniques above it — tensor parallelism, prefill/decode disaggregation, smart routing across workers — pay off most directly, since they let you add hardware and get closer to a linear throughput increase instead of hitting diminishing returns on a single device. At the bottom of the stack, throughput ultimately traces back to the roofline model at L3: you're throughput-bound by whichever resource (compute or memory bandwidth) your kernels saturate first, for whichever phase (prefill or decode) dominates your workload."
    },
    {
        id: 'l2-tensor-parallelism',
        layer: 'L2',
        title: 'Tensor Parallelism',
        text: "Tensor parallelism splits individual weight matrices (and the matrix multiplications that use them) across multiple GPUs, so each GPU holds a shard of every layer rather than one GPU holding the whole model. This is necessary once a model is too large to fit in one GPU's memory, or when you need the per-request latency of splitting a single forward pass across devices rather than just replicating the whole model for throughput. The cost is communication: GPUs need to exchange partial results (typically an all-reduce) after specific operations within every layer, so tensor parallelism requires fast interconnect (NVLink, InfiniBand) and the number of shards is usually kept small (2–8 GPUs) because communication overhead grows with more splits. This is a direct, higher-scale instance of the L1 partitioning idea applied to model weights instead of data, and it's the main lever for scaling a single request's latency down when the model itself — not the batch — is the bottleneck. It composes with everything else in L2: a tensor-parallel group of GPUs is typically treated as one logical worker by the scheduler and router sitting above it."
    },
    {
        id: 'l2-prefill-decode-disaggregation',
        layer: 'L2',
        title: 'Prefill/Decode Disaggregation',
        text: "Prefill (processing the whole input prompt in one compute-bound forward pass) and decode (generating one token at a time, memory-bandwidth-bound) have fundamentally different resource profiles, but naive serving runs both phases on the same GPUs, which means a GPU busy decoding long outputs for existing requests delays the prefill of new requests — directly hurting TTFT — and vice versa. Splitwise and DistServe (recent papers on this specific problem) propose disaggregation: run prefill and decode on separate pools of GPUs, and transfer the KV cache for a request from a 'prefill worker' to a 'decode worker' once its prompt has been processed. This removes the interference between the two phases and lets you provision each pool to match its actual bottleneck (more raw compute for prefill, more memory bandwidth/capacity for decode), at the cost of added complexity: a fast interconnect to move KV cache between workers, and a routing layer that knows how to pair prefill and decode workers for a given request. This is the current frontier of L2 distributed-inference design, and it depends on everything below it — efficient KV cache representation (PagedAttention) to make the transfer cheap, and a router above it that implements the pairing logic."
    },
    {
        id: 'l2-routing-across-workers',
        layer: 'L2',
        title: 'Routing Across Workers',
        text: "Once you have a fleet of inference workers — possibly specialized into prefill pools, decode pools, and different tensor-parallel groups — something has to decide which worker handles each incoming request. Naive round-robin routing ignores the fact that workers have wildly different load depending on what's already in their KV cache and queue, so smarter routers use signals like queue depth, estimated prompt/output length, and — in disaggregated setups — which decode worker is 'closest' (cheapest KV cache transfer) to the prefill worker that just finished. This is the inference-serving analog of load balancing in any distributed system (same conceptual ancestor as the L1 replication/partitioning discussion), but with inference-specific state that a generic load balancer doesn't know about: cache locality matters here the way it matters for routing to a specific shard in a sharded database. Good routing is what makes all the lower-level work (disaggregation, tensor parallelism, continuous batching) actually pay off in aggregate fleet throughput rather than just shifting bottlenecks from one worker to another; it's the outermost L2 decision before a request's tokens flow back up into L1 and out to the caller."
    },

    // ---------------- L3: kernels & the GPU ----------------
    {
        id: 'l3-cuda-programming-model',
        layer: 'L3',
        title: 'The CUDA Programming Model',
        text: "CUDA organizes GPU work into a hierarchy: a kernel launch spawns a grid of thread blocks, each block contains many threads, and threads within a block can cooperate (share memory, synchronize) while blocks run largely independently and get scheduled onto the GPU's streaming multiprocessors (SMs) as resources free up. This hierarchy exists because GPUs get their throughput from massive parallelism — thousands of lightweight threads executing the same instruction on different data (SIMT) — rather than from a few fast cores, which is the opposite design point from a CPU. Understanding this model (covered thoroughly in Kirk & Hwu's *Programming Massively Parallel Processors*) is the prerequisite for everything else at L3: the roofline model tells you whether a kernel is compute- or memory-bound, memory coalescing and shared-memory tiling are techniques for feeding threads efficiently within this hierarchy, and occupancy is literally a measurement of how well a kernel uses it. One layer up, every L2 serving optimization (batching, KV cache layout, disaggregation) ultimately expresses itself as kernels launched under this exact model — L2 decides *what* work to do, L3 is *how* the GPU actually does it."
    },
    {
        id: 'l3-memory-hierarchy',
        layer: 'L3',
        title: 'GPU Memory Hierarchy',
        text: "A GPU has several tiers of memory with very different size/speed tradeoffs: registers (per-thread, fastest, tiny), shared memory (per-block, fast, programmer-managed, a few dozen KB), L2 cache, and global memory/HBM (large — tens of GB — but hundreds of cycles slower to access than shared memory). Writing a fast kernel is largely an exercise in minimizing trips to global memory and maximizing reuse of data once it's been pulled into registers or shared memory — this is the central theme of Kirk & Hwu's PMPP and the practical heart of L3 work. It's directly where the roofline model gets its teeth: a kernel that reads each byte from global memory once and does a lot of compute on it is compute-bound and fast; a kernel that reads a lot of memory relative to the compute it does is memory-bound and will be slow no matter how many FLOPs the GPU can theoretically do. Going up a layer, this is exactly why decode steps in LLM inference are memory-bandwidth-bound (lots of KV cache movement, little compute per token) while prefill is compute-bound (one big matmul over the whole prompt) — the L2 serving metrics TTFT and inter-token latency are downstream consequences of this memory hierarchy."
    },
    {
        id: 'l3-roofline-model',
        layer: 'L3',
        title: 'The Roofline Model',
        text: "The roofline model (from Hennessy & Patterson's *Computer Architecture: A Quantitative Approach*, and the classic performance-analysis tool for any compute device) plots achievable performance against a kernel's arithmetic intensity — the ratio of floating-point operations to bytes of memory traffic. Every device has a 'roof': a flat ceiling set by peak compute throughput, and a sloped ceiling set by peak memory bandwidth; a kernel's actual performance is capped by whichever ceiling it hits first, so you can instantly classify any kernel as compute-bound or memory-bound just by computing its arithmetic intensity. This single idea is the organizing principle for all GPU kernel optimization: it tells you whether you should spend effort reducing memory traffic (coalescing, tiling, better cache reuse) or increasing compute efficiency (better instruction scheduling, more occupancy) — optimizing the wrong side of the roofline wastes effort. It's also the precise, rigorous version of the intuitive claim one layer up that prefill is compute-bound and decode is memory-bound: you can actually compute the arithmetic intensity of an attention or matmul kernel and see which ceiling it's hitting, which is exactly what profiling tools surface in practice."
    },
    {
        id: 'l3-memory-coalescing',
        layer: 'L3',
        title: 'Memory Coalescing',
        text: "When threads in a GPU warp (a group of 32 threads executing in lockstep) access global memory, the hardware can combine ('coalesce') those accesses into a single wide memory transaction if the addresses are contiguous and properly aligned — if they're scattered, the hardware issues many separate transactions instead, wasting most of the available memory bandwidth. This is the single most common reason a straightforward CUDA kernel underperforms: the logic is correct, but the memory access pattern (e.g. iterating over data in the wrong order, or using a stride that misaligns across threads) leaves bandwidth on the table. It's a direct, concrete instance of the roofline model's memory-bound case — poor coalescing effectively lowers your achievable memory bandwidth below the hardware's real ceiling, which is strictly worse than just being memory-bound. Fixing it usually means restructuring data layout or access order so consecutive threads touch consecutive addresses, which is exactly the kind of low-level reasoning you get hands-on practice with by finishing the NVIDIA CUDA course and profiling your own kernels rather than only reading about it."
    },
    {
        id: 'l3-shared-memory-tiling',
        layer: 'L3',
        title: 'Shared-Memory Tiling',
        text: "Tiling is the technique of loading a chunk ('tile') of data from slow global memory into fast, on-chip shared memory once, then having many threads in the block reuse that tile repeatedly from shared memory instead of each thread re-fetching the same data from global memory. The canonical example is matrix multiplication: naive implementations re-read the same rows/columns from global memory many times, while a tiled implementation loads sub-blocks of each matrix into shared memory once and lets every thread in the block reuse them, cutting global memory traffic dramatically. This directly improves arithmetic intensity in the roofline sense — same amount of compute, far less memory traffic — which is why tiling is one of the first real optimizations taught in PMPP and one of the first big wins you get from writing your own kernels. It's also conceptually what FlashAttention does for attention specifically: instead of materializing the full attention score matrix in global memory, it tiles the computation to keep intermediate results in fast on-chip memory, which is the direct reason FlashAttention made long-context attention both faster and far more memory-efficient — a kernel-level idea with an immediate, large payoff one layer up in L2 serving."
    },
    {
        id: 'l3-occupancy',
        layer: 'L3',
        title: 'Occupancy',
        text: "Occupancy measures how many warps are actively resident on a streaming multiprocessor (SM) relative to its maximum capacity, and it matters because GPUs hide memory latency by switching between warps — while one warp waits on a slow memory access, the SM can execute instructions from another warp instead of sitting idle. Low occupancy means there aren't enough warps available to cover those stalls, so the SM sits idle waiting on memory even though, on paper, it has plenty of compute capacity. Occupancy is constrained by resource usage per thread/block: using too many registers or too much shared memory per thread limits how many blocks can be resident simultaneously, which creates a real tradeoff against the shared-memory tiling technique described above — more tiling data in shared memory can mean fewer concurrently resident blocks. This is exactly the kind of tradeoff that profiling tools (Nsight Compute, nvprof) are built to surface, and exactly the kind of tuning decision that separates a merely-correct kernel from a fast one — which is the whole point of the 'profile the kernels I wrote myself' part of the plan."
    },
    {
        id: 'l3-triton',
        layer: 'L3',
        title: 'Triton',
        text: "Triton is a Python-embedded language and compiler (from OpenAI) for writing GPU kernels at a higher level than raw CUDA C++, while still giving you explicit control over the things that actually determine performance — tiling, memory access patterns, and block-level parallelism — rather than hiding them behind a framework's default kernels. The reason it matters for inference serving specifically is that it's become the default tool for writing custom fused kernels for exactly the operations that dominate LLM inference cost: attention variants, fused matmul+activation, quantized matmul, and so on — vLLM and other serving engines use Triton kernels extensively. It's a useful second step after CUDA fundamentals (PMPP, the NVIDIA CUDA course) rather than a replacement for them: Triton still requires you to reason in terms of the roofline model, memory coalescing, tiling, and occupancy — it just automates some of the tedious scheduling and indexing bookkeeping so you can iterate faster once the underlying concepts are solid. In practice, this is the tool you'd reach for to go implement your own version of a technique like FlashAttention rather than writing it in raw CUDA."
    },
    {
        id: 'l3-kernel-profiling',
        layer: 'L3',
        title: 'Kernel Profiling',
        text: "Profiling tools (Nsight Compute, Nsight Systems, nvprof/nsys) measure what a kernel actually does on real hardware — achieved occupancy, memory throughput vs. peak, compute throughput vs. peak, warp stall reasons, and where time is spent across a whole program's kernel launches — rather than relying on theoretical reasoning alone. This closes the loop on every other L3 concept: the roofline model tells you in theory whether a kernel should be compute- or memory-bound, but only a profiler tells you whether your actual kernel is hitting the ceiling it should be, or losing performance to poor coalescing, low occupancy, or unnecessary synchronization. This is the step most self-taught CUDA learning skips — reading about tiling and occupancy is necessary but not sufficient; profiling your own kernels is what turns that reading into real intuition for where time actually goes, which is exactly the 'profile kernels I wrote myself' part of the plan. It's also the practical bridge back up to L2: when a serving engine is slow, profiling is how you find out whether the bottleneck is actually a kernel (L3), or scheduling/batching overhead one layer up (L2) — without profiling, that distinction is just a guess."
    },
    {
        id: 'l3-flashattention',
        layer: 'L3',
        title: 'FlashAttention',
        text: "FlashAttention (the paper, with no book treatment — like PagedAttention, Orca, and Splitwise/DistServe, this is current enough that papers are the primary source) rewrites the attention computation to avoid ever materializing the full N×N attention score matrix in slow global memory. Standard attention computes the full score matrix, applies softmax, then multiplies by values — for long sequences that matrix is huge and the memory traffic to write and re-read it dominates the runtime, even though the actual FLOP count is modest. FlashAttention uses exactly the tiling idea from shared-memory tiling above: it processes attention in blocks, keeping partial results in fast on-chip memory and using an online/running softmax so it never needs the full matrix materialized at once. The result is an attention kernel that's both faster (higher arithmetic intensity, better roofline positioning) and dramatically more memory-efficient — which is precisely what made long-context models practical at all, and it's a direct example of an L3 kernel technique producing an L2-visible outcome (lower latency, higher throughput, longer feasible context) without changing the model's math one bit."
    }
];
