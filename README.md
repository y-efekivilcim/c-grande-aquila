# Grande Aquila

A character-level neural network that trains in real-time against a fixed poem. Drag the neurons to break it.

The network runs entirely in a Web Worker — backpropagation from scratch, no ML library. The main thread renders the weight matrix as a canvas: connections are coloured by sign (blue for positive, orange for negative) and thickness scales with magnitude. The poem above the network is the training target. As the network learns, characters converge toward it line by line.

**[→ kivilcimlab.org/grande-aquila](https://kivilcimlab.org/grande-aquila)**

---

## The entropy mechanic

Dragging a neuron doesn't just move a visual element. The displacement from resting position is accumulated as an entropy scalar and sent into the Web Worker, where it directly corrupts the weight matrices mid-training. The loss spikes. The poem glitches. Convergence has to restart.

The physical state of the visualisation is coupled to the computational state of the network.

## Architecture

```
Input layer (character encoding)
      ↓
Hidden layer (ReLU activation)
      ↓
Output layer (numerically stable softmax)
```

Weights are Xavier-initialised. Forward and backward passes are hand-written — no autograd. The worker runs a continuous training loop, posting weight snapshots to the main thread at each step for rendering.

## Implementation notes

- **No ML library.** Matrix ops are plain JS arrays.
- **Xavier initialisation:** `Math.sqrt(6 / (fan_in + fan_out))` per connection.
- **Stable softmax:** max-subtraction before exponentiation to prevent overflow.
- **60 FPS canvas:** rendering is decoupled from training; the worker posts async, the canvas draws on `requestAnimationFrame`.

## Stack

- Vanilla JS
- Web Workers (training thread)
- HTML5 Canvas (visualisation)
