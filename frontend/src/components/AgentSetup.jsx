import React from 'react'

export default function AgentSetup() {
  const server = window.location.origin
  return (
    <section className="card">
      <h2>Connect a machine</h2>
      <p>
        Tuning runs on the CPU you want to optimise, not on this web server. Start the agent on that
        machine; it connects out to this site over HTTPS, so no inbound ports are needed.
      </p>
      <pre>{`git clone https://github.com/gccandfde/CPU-LLM && cd CPU-LLM/backend
python -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m cpullm.agent --server ${server} --token <AGENT_TOKEN>`}</pre>
      <p className="muted">The machine appears here within a few seconds of starting.</p>
    </section>
  )
}
