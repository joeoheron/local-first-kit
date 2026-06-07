import { defineConfig } from 'unocss';
import { presetMini } from '@unocss/preset-mini';
import transformerDirectives from '@unocss/transformer-directives';
import transformerVariantGroup from '@unocss/transformer-variant-group';

export default defineConfig({
  presets: [presetMini()],

  theme: {
    colors: {
      canvas:       'hsl(var(--canvas) / <alpha-value>)',
      surface:      'hsl(var(--surface) / <alpha-value>)',
      'surface-2':  'hsl(var(--surface-2) / <alpha-value>)',
      stroke:       'hsl(var(--stroke) / <alpha-value>)',
      fg:           'hsl(var(--fg) / <alpha-value>)',
      'fg-muted':   'hsl(var(--fg-muted) / <alpha-value>)',
      muted:        'hsl(var(--muted) / <alpha-value>)',
      primary:      'hsl(var(--primary) / <alpha-value>)',
      'primary-fg': 'hsl(var(--primary-fg) / <alpha-value>)',
      destructive:  'hsl(var(--destructive) / <alpha-value>)',
      warning:      'hsl(var(--warning) / <alpha-value>)',
      success:      'hsl(var(--success) / <alpha-value>)',
      info:         'hsl(var(--info) / <alpha-value>)',
    },
  },

  shortcuts: {
    // Buttons
    'btn':           'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed',
    'btn-xs':        'btn px-2.5 py-1 text-xs',
    'btn-sm':        'btn px-3 py-1.5',
    'btn-md':        'btn px-4 py-2',
    'btn-lg':        'btn w-full px-4 py-2.5 text-base',
    'btn-primary':   'bg-primary text-primary-fg hover:bg-primary/90',
    'btn-secondary': 'bg-surface border border-stroke text-fg hover:bg-canvas',
    'btn-ghost':     'text-fg-muted hover:text-fg hover:bg-surface-2',
    'btn-danger':    'text-destructive hover:bg-destructive/10',
    'btn-warning':   'bg-warning text-primary-fg hover:bg-warning/90',
    'btn-link':      'text-fg-muted underline-offset-4 hover:underline hover:text-fg',

    // Inputs
    'field':    'w-full rounded-md border border-stroke bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 disabled:opacity-50',
    'field-lg': 'w-full rounded-md border border-stroke bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 disabled:opacity-50',

    // Navigation tabs — pill style
    'tab':          'px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer',
    'tab-active':   'tab bg-surface-2 text-fg font-medium',
    'tab-inactive': 'tab text-fg-muted hover:bg-surface-2 hover:text-fg',

    // Cards / panels — surface (white) lifts off canvas (slate-50)
    'card':      'rounded-lg border border-stroke bg-surface p-4',
    'card-auth': 'flex flex-col w-full max-w-sm rounded-lg border border-stroke bg-surface gap-6 p-8',
    'panel':     'border-b border-stroke bg-surface px-4 py-3',

    // Alerts — light tints for white/near-white backgrounds
    'alert-error':   'rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive',
    'alert-success': 'rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success',
    'alert-info':    'rounded-md border border-primary/20 bg-primary/10 p-3 text-sm text-primary',
    'alert-warning': 'rounded-md border border-warning/30 bg-warning/10 p-4 text-warning',

    // Badge
    'badge': 'rounded-md px-2 py-0.5 text-xs font-medium',
  },

  rules: [
    ['select-all', { 'user-select': 'all' }],
  ],

  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
});
