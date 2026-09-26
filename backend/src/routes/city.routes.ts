import { Router } from "express";
import { getCities } from "../controllers/city.controller";

const router = Router();

router.get("/", getCities);

export default router;
