"""NetworkX-based GraphRAG Knowledge Graph Engine for JARVIS Second Brain."""
import os
import json
import re
import time
import uuid
import networkx as nx
from filelock import FileLock

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GRAPH_PATH = os.path.join(BASE_DIR, "qdrant_db", "knowledge_graph.json")
LOCK_PATH = GRAPH_PATH + ".lock"
os.makedirs(os.path.dirname(GRAPH_PATH), exist_ok=True)

class GraphRAGEngine:
    def __init__(self):
        self.graph = nx.DiGraph()
        self.load_graph()

    def _load_graph_nolock(self):
        """Loads Knowledge Graph from local JSON file if exists without acquiring a lock."""
        if os.path.exists(GRAPH_PATH):
            try:
                with open(GRAPH_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.graph = nx.node_link_graph(data)
            except Exception as e:
                print(f"[GraphRAG Warning]: Error loading graph: {e}")

    def load_graph(self):
        """Thread/Process-safe loading of the graph."""
        try:
            with FileLock(LOCK_PATH, timeout=10):
                self._load_graph_nolock()
        except Exception as e:
            print(f"[GraphRAG Warning]: Error acquiring lock to load graph: {e}")

    def _save_graph_nolock(self):
        """Saves graph to local JSON file atomically using a unique temp file."""
        tmp_path = f"{GRAPH_PATH}.{uuid.uuid4().hex}.tmp"
        try:
            data = nx.node_link_data(self.graph)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, separators=(',', ':'))
            
            os.replace(tmp_path, GRAPH_PATH)
        except Exception as e:
            print(f"[GraphRAG Error]: Error saving graph: {e}")
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    def add_relation(self, source: str, relation: str, target: str, weight: float = 1.0):
        """Adds or updates an edge in the entity relationship graph. Thread-safe."""
        src = source.strip().title()
        tgt = target.strip().title()
        rel = relation.strip().upper()
        
        if not src or not tgt:
            return

        try:
            with FileLock(LOCK_PATH, timeout=15):
                if self.graph.number_of_nodes() == 0:
                    self._load_graph_nolock()
                
                self.graph.add_node(src, label=src)
                self.graph.add_node(tgt, label=tgt)
                
                if self.graph.has_edge(src, tgt):
                    self.graph[src][tgt]['weight'] += weight
                else:
                    self.graph.add_edge(src, tgt, relation=rel, weight=weight)
                    
                self._save_graph_nolock()
        except Exception as e:
            print(f"[GraphRAG Error]: Error in add_relation: {e}")

    def add_relations_batch(self, relations: list):
        """Adds or updates multiple edges in the entity relationship graph. Thread-safe."""
        if not relations:
            return

        try:
            with FileLock(LOCK_PATH, timeout=15):
                if self.graph.number_of_nodes() == 0:
                    self._load_graph_nolock()
                
                for source, relation, target, weight in relations:
                    src = source.strip().title()
                    tgt = target.strip().title()
                    rel = relation.strip().upper()
                    
                    if not src or not tgt:
                        continue
                        
                    self.graph.add_node(src, label=src)
                    self.graph.add_node(tgt, label=tgt)
                    
                    if self.graph.has_edge(src, tgt):
                        self.graph[src][tgt]['weight'] += weight
                    else:
                        self.graph.add_edge(src, tgt, relation=rel, weight=weight)
                    
                self._save_graph_nolock()
        except Exception as e:
            print(f"[GraphRAG Error]: Error in add_relations_batch: {e}")

    def extract_and_ingest(self, text: str):
        """Rule-based entity & relation extraction for fast GraphRAG population."""
        tech_keywords = ["Llama", "Whisper", "Qdrant", "Ollama", "PyTorch", "FastAPI", "Edge-TTS", "LangGraph", "ChromaDB", "ESP32", "Radar", "OpenCV", "Vite", "React"]
        concept_keywords = ["Second Brain", "Yadash", "GraphRAG", "Vibe Coding", "ECE", "Hardware", "Audio", "Memory", "Spatial Intelligence", "RuView", "RuField"]
        music_keywords = ["Metro Boomin", "Travis Scott", "Seedhe Maut", "XXXTENTACION", "KR$NA", "Raftaar", "Raga"]
        project_keywords = ["SPARK", "Glitched.CultFit", "ShareKart", "ShareKart Hero", "Comeback", "jarvis-room", "Anime Recommender"]
        roadmap_keywords = ["mission_Germany", "MS in Germany", "ECE Career Roadmap"]
        philosophy_keywords = ["Attaining Enlightenment", "Pieces", "Peace", "Impressionism", "Van Gogh", "Starry Night"]
        hardware_keywords = ["RC Car", "Adaptive Smart Street Light", "Laser Turret", "Ultrasonic Sensor", "Bluetooth Module", "LD2450", "LD2410", "ESP32-S3"]

        entities_found = []
        all_kw = tech_keywords + concept_keywords + music_keywords + project_keywords + roadmap_keywords + philosophy_keywords + hardware_keywords
        for kw in all_kw:
            if re.search(r"\b" + re.escape(kw) + r"\b", text, re.IGNORECASE):
                entities_found.append(kw)

        user_node = "Boss"
        for entity in set(entities_found):
            if entity in music_keywords:
                self.add_relation(user_node, "LISTENS_TO", entity)
            elif entity in tech_keywords:
                self.add_relation("JARVIS", "POWERED_BY", entity)
                self.add_relation(user_node, "USES_TECH", entity)
            elif entity in concept_keywords:
                self.add_relation(user_node, "RESEARCHING", entity)
            elif entity in project_keywords:
                self.add_relation(user_node, "OWNS_PROJECT", entity)
            elif entity in roadmap_keywords:
                self.add_relation(user_node, "TRACKS_ROADMAP", entity)
            elif entity in philosophy_keywords:
                self.add_relation(user_node, "EXPRESSES_PHILOSOPHY", entity)
            elif entity in hardware_keywords:
                self.add_relation(user_node, "INVENTED_HARDWARE", entity)

    def get_subgraph_context(self, query: str) -> str:
        """Traverses the GraphRAG knowledge graph using Personalized PageRank (PPR) to return top semantic triples."""
        if self.graph.number_of_nodes() == 0:
            self.load_graph()
            
        q_lower = query.lower().strip()
        matched_nodes = []
        
        # 1. Direct or Partial Node Matching
        for n in self.graph.nodes():
            n_str = str(n).lower()
            if q_lower in n_str or n_str in q_lower:
                matched_nodes.append(n)
                
        # Filter out raw hashes or asset filenames
        filtered_matches = [
            n for n in matched_nodes 
            if not re.match(r"^[0-9A-Fa-f]{16,}\.(jpg|png|jpeg)$", str(n), re.IGNORECASE)
        ]
                
        if not filtered_matches:
            filtered_matches = [
                n for n in self.graph.nodes() 
                if any(kw in str(n).lower() for kw in ["spark", "sharekart", "design", "hardware", "boss", "jarvis"])
            ][:10]

        if not filtered_matches:
            return ""

        # 2. Compute Personalized PageRank (PPR) starting from matched nodes
        personalization = {n: 1.0 / len(filtered_matches) for n in filtered_matches}
        
        triples = []
        try:
            # Calculate PPR across graph
            pr_scores = nx.pagerank(self.graph, personalization=personalization, weight="weight", max_iter=50)
            # Sort top ranked nodes
            top_nodes = sorted(pr_scores.items(), key=lambda x: x[1], reverse=True)[:15]
            
            for node, score in top_nodes:
                for target in self.graph.successors(node):
                    target_str = str(target)
                    node_str = str(node)
                    if re.search(r"\.(jpg|png|jpeg|gif|bmp|webp)$", target_str, re.IGNORECASE) or re.search(r"\.(jpg|png|jpeg|gif|bmp|webp)$", node_str, re.IGNORECASE):
                        continue
                    edge_data = self.graph.get_edge_data(node, target)
                    rel = edge_data.get("relation", "RELATED_TO")
                    triples.append(f"- [{node}] -({rel})-> [{target}]")
                    if len(triples) >= 15:
                        break
                if len(triples) >= 15:
                    break
        except Exception as e:
            # Fallback to direct successor traversal if PPR fails
            for node in filtered_matches[:5]:
                for target in self.graph.successors(node):
                    edge_data = self.graph.get_edge_data(node, target)
                    rel = edge_data.get("relation", "RELATED_TO")
                    triples.append(f"- [{node}] -({rel})-> [{target}]")

        if not triples:
            return ""

        return "GRAPH-RAG KNOWLEDGE CONNECTIONS:\n" + "\n".join(list(dict.fromkeys(triples[:15]))) + "\n"

    def save_graph(self):
        """Thread-safe public method to persist the knowledge graph to disk."""
        try:
            with FileLock(LOCK_PATH, timeout=15):
                self._save_graph_nolock()
                print("[GraphRAG]: Graph successfully saved to disk.")
        except Exception as e:
            print(f"[GraphRAG Error]: Failed to save graph: {e}")


# Singleton Instance
graph_rag = GraphRAGEngine()

if __name__ == "__main__":
    print("Testing GraphRAG Engine...")
    graph_rag.extract_and_ingest("Boss is an ECE student listening to Metro Boomin and building JARVIS powered by Llama 3.1 and Qdrant.")
    print(graph_rag.get_subgraph_context("Tell me about Boss and JARVIS"))
