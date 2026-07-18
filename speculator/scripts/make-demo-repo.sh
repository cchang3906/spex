#!/bin/bash
set -euo pipefail
dir="${1:?usage: make-demo-repo.sh <dir> [--baseline]}"
mode="${2:-steered}"
size="${3:-small}"
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"

cat > calc.py <<'EOF'
def average(xs):
    return sum(xs) / (len(xs) + 1)

def total(xs):
    return sum(xs)
EOF

cat > test_calc.py <<'EOF'
import unittest
from calc import average, total

class TestCalc(unittest.TestCase):
    def test_average(self):
        self.assertEqual(average([2, 4, 6]), 4)

    def test_total(self):
        self.assertEqual(total([1, 2, 3]), 6)

if __name__ == "__main__":
    unittest.main()
EOF

cat > test_integration.py <<'EOF'
import time
import unittest
from calc import average, total

class TestIntegration(unittest.TestCase):
    def test_pipeline(self):
        time.sleep(4)
        data = [[1, 2, 3], [4, 5, 6], [10, 20, 30]]
        self.assertEqual([total(d) for d in data], [6, 15, 60])
        self.assertEqual(average([total(d) for d in data]), 27)

if __name__ == "__main__":
    unittest.main()
EOF

printf '__pycache__/\n.prefetch/\n' > .gitignore

if [ "$mode" != "--baseline" ]; then
cat > AGENTS.md <<'EOF'
## Verification
This workspace provides a `prefetch_verify` tool. Whenever you need to run tests, lint,
typechecking, or a build to verify your changes, ALWAYS call `prefetch_verify` with the
appropriate kind instead of running those commands in the terminal. It executes the exact same
command in the same sandbox and returns the exit code and output — usually much faster, because
the result may already be prepared. For all other commands, use the terminal normally.
EOF
fi

if [ "$size" = "--large" ] || [ "$mode" = "--large" ]; then
rm -f calc.py test_calc.py test_integration.py
cat > pricing.py <<'PYEOF'
def discount(price, pct):
    return price * (1 + pct / 100)

def bulk_price(unit, qty):
    tiers = [(100, 0.8), (50, 0.9), (10, 0.95)]
    for threshold, mult in tiers:
        if qty >= threshold:
            return unit * qty * mult
    return unit * qty
PYEOF
cat > tax.py <<'PYEOF'
def add_tax(amount, rate):
    return round(amount * rate, 2)

def split_tax(gross, rate):
    net = gross * (1 - rate)
    return round(net, 2), round(gross - net, 2)
PYEOF
cat > cart.py <<'PYEOF'
from pricing import discount, bulk_price
from tax import add_tax

def cart_total(items, tax_rate):
    subtotal = sum(bulk_price(i["unit"], i["qty"]) for i in items)
    return add_tax(subtotal, 1 + tax_rate)
PYEOF
cat > test_pricing.py <<'PYEOF'
import unittest
from pricing import discount, bulk_price

class TestPricing(unittest.TestCase):
    def test_discount(self):
        self.assertEqual(discount(100, 20), 80)

    def test_bulk(self):
        self.assertEqual(bulk_price(10, 100), 800)
        self.assertEqual(bulk_price(10, 5), 50)

if __name__ == "__main__":
    unittest.main()
PYEOF
cat > test_tax.py <<'PYEOF'
import unittest
from tax import add_tax, split_tax

class TestTax(unittest.TestCase):
    def test_add_tax(self):
        self.assertEqual(add_tax(100, 1.13), 113.0)

    def test_split(self):
        net, tax = split_tax(113, 0.13)
        self.assertEqual(net, 100.0)

if __name__ == "__main__":
    unittest.main()
PYEOF
cat > test_cart.py <<'PYEOF'
import time
import unittest
from cart import cart_total

class TestCart(unittest.TestCase):
    def test_total(self):
        time.sleep(6)
        items = [{"unit": 10, "qty": 100}, {"unit": 5, "qty": 5}]
        self.assertEqual(cart_total(items, 0.13), 932.25)

if __name__ == "__main__":
    unittest.main()
PYEOF
fi
git init -q
git add -A
git -c user.name="Demo" -c user.email="demo@example.com" -c commit.gpgsign=false commit -qm "initial commit"
echo "$dir ready ($mode): fresh history, bug present from commit 1"
