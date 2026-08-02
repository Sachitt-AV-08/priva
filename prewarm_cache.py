import asyncio
import sys
sys.path.insert(0, '.')

QUERIES = [
    ("wireless headphones", 200, 10),
    ("running shoes", 150, 10),
    ("mechanical keyboard", 120, 10),
    ("usb hub", 50, 10),
]

async def main():
    from serpapi_client import search_products
    total = 0
    for q, price, limit in QUERIES:
        try:
            products = await search_products(q, price, limit)
            total += len(products)
            print(f"[OK] {q}: {len(products)} products")
        except Exception as e:
            print(f"[FAIL] {q}: {e}")
    print(f"DONE, {total} products cached")

asyncio.run(main())
