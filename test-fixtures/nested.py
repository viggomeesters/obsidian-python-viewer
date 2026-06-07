def outer(value: int) -> int:
    def inner(amount: int) -> int:
        return amount + 1

    return inner(value)


async def fetch_data(client):
    return await client.get("/data")

