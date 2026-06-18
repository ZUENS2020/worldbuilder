#!/usr/bin/env python3
"""Seed the minimal simulator test graph — thin wrapper around import_world."""

import import_world

if __name__ == "__main__":
    import_world.import_module("sim_test_data")
